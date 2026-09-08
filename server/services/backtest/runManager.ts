import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { backtestRuns, type BacktestRun } from "../../../drizzle/schema";
import type { Db } from "../../db";
import { getHistoryService, HistoryService } from "../history/service";
import { runBacktest, BacktestCancelled } from "./engine";
import type { BacktestInput, BacktestResult } from "./types";

/**
 * 回测 run 管理器
 *
 * - 幂等：idempotencyKey = sha256(规范化输入)（未显式提供时）；
 *   同键重复 create 返回已有 run，不重复执行；
 * - rerun 永远创建新 run（parentRunId 链接，不覆盖旧结果）；
 * - cancel：运行中/排队中可取消（checkpoint 检查）；
 * - pause/resume：pause 在 checkpoint 落 paused；resume 重新执行
 *   （引擎确定性，重放结果一致，进度从 0 重新计数，run id 不变）；
 * - 崩溃恢复：服务重启后 stuck 在 queued/running/paused 的 run 标记 failed
 *   （绝不把未完成 run 伪装成 completed）。
 */

export interface RunManagerDeps {
  db: Db;
  history?: HistoryService;
}

const activeControls = new Map<number, { cancel: boolean; pause: boolean }>();

export function computeIdempotencyKey(input: BacktestInput, dataVersion?: string): string {
  const h = createHash("sha256");
  h.update(JSON.stringify({ input, dataVersion: dataVersion ?? "unknown" }));
  return h.digest("hex").slice(0, 32);
}

export class BacktestRunManager {
  private readonly db: Db;
  private readonly history: HistoryService;

  constructor(deps: RunManagerDeps) {
    this.db = deps.db;
    this.history = deps.history ?? getHistoryService();
  }

  /** 启动恢复：把中断的 run 标记 failed（绝不伪装成 completed） */
  async recoverInterruptedRuns(): Promise<number> {
    const updated = await this.db
      .update(backtestRuns)
      .set({ status: "failed", error: "服务重启导致任务中断", finishedAt: new Date() })
      .where(inArray(backtestRuns.status, ["queued", "running", "paused"]))
      .returning();
    return updated.length;
  }

  async createRun(userId: number, input: BacktestInput, idempotencyKey?: string): Promise<BacktestRun> {
    const key = idempotencyKey ?? computeIdempotencyKey(input);

    // 幂等：同键返回已有 run
    const existing = await this.db
      .select()
      .from(backtestRuns)
      .where(and(eq(backtestRuns.userId, userId), eq(backtestRuns.idempotencyKey, key)))
      .limit(1);
    if (existing[0]) return existing[0];

    const inserted = await this.db
      .insert(backtestRuns)
      .values({ userId, idempotencyKey: key, params: input, status: "queued" })
      .returning();
    const run = inserted[0];
    // 异步执行（不阻塞请求）
    void this.execute(run.id, userId, input);
    return run;
  }

  async rerun(userId: number, runId: number): Promise<BacktestRun | null> {
    const old = await this.getRun(userId, runId);
    if (!old) return null;
    const input = old.params as BacktestInput;
    const key = `${computeIdempotencyKey(input, old.dataVersion ?? undefined)}#rerun:${runId}:${Date.now()}`;
    const inserted = await this.db
      .insert(backtestRuns)
      .values({
        userId,
        idempotencyKey: key.slice(0, 80),
        parentRunId: runId,
        params: input,
        status: "queued",
      })
      .returning();
    const run = inserted[0];
    void this.execute(run.id, userId, input);
    return run;
  }

  private async execute(runId: number, userId: number, input: BacktestInput): Promise<void> {
    const control = { cancel: false, pause: false };
    activeControls.set(runId, control);
    try {
      await this.db
        .update(backtestRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(backtestRuns.id, runId));

      // 1. 获取历史数据（fixture 或 longbridge；失败即 failed，不伪造）
      const dataset = await this.history.getHistory({
        symbol: input.symbol,
        period: input.period,
        startTime: input.startTime,
        endTime: input.endTime,
        source: input.source,
      });

      await this.db
        .update(backtestRuns)
        .set({ dataVersion: dataset.dataVersion, progressTotal: dataset.bars.length })
        .where(eq(backtestRuns.id, runId));

      // 2. 运行引擎（checkpoint 检查 cancel/pause）
      const result = runBacktest(dataset.bars, input, {
        dataVersion: dataset.dataVersion,
        source: dataset.source,
        warnings: dataset.warnings,
      }, {
        progressEvery: 50,
        onProgress: (processed, total) => {
          void this.db
            .update(backtestRuns)
            .set({ progressProcessed: processed, progressTotal: total })
            .where(eq(backtestRuns.id, runId))
            .catch(() => undefined);
          if (control.cancel) return "cancel";
          return undefined;
        },
      });

      if (control.pause) {
        await this.db
          .update(backtestRuns)
          .set({ status: "paused", progressProcessed: 0 })
          .where(eq(backtestRuns.id, runId));
        return;
      }

      await this.db
        .update(backtestRuns)
        .set({
          status: "completed",
          result: JSON.parse(JSON.stringify(result)),
          progressProcessed: result.meta.barCount,
          finishedAt: new Date(),
        })
        .where(eq(backtestRuns.id, runId));
    } catch (err) {
      if (err instanceof BacktestCancelled) {
        await this.db
          .update(backtestRuns)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(eq(backtestRuns.id, runId));
      } else {
        await this.db
          .update(backtestRuns)
          .set({ status: "failed", error: (err as Error).message.slice(0, 500), finishedAt: new Date() })
          .where(eq(backtestRuns.id, runId));
      }
    } finally {
      activeControls.delete(runId);
    }
  }

  async getRun(userId: number, runId: number): Promise<BacktestRun | null> {
    const rows = await this.db
      .select()
      .from(backtestRuns)
      .where(and(eq(backtestRuns.id, runId), eq(backtestRuns.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listRuns(userId: number, limit = 20): Promise<BacktestRun[]> {
    return this.db
      .select()
      .from(backtestRuns)
      .where(eq(backtestRuns.userId, userId))
      .orderBy(desc(backtestRuns.createdAt))
      .limit(limit);
  }

  async getResult(userId: number, runId: number): Promise<BacktestResult | null> {
    const run = await this.getRun(userId, runId);
    if (!run || run.status !== "completed" || !run.result) return null;
    return run.result as unknown as BacktestResult;
  }

  async cancel(userId: number, runId: number): Promise<BacktestRun | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return run; // 终态不变
    }
    const control = activeControls.get(runId);
    if (control) {
      control.cancel = true;
      return this.getRun(userId, runId);
    }
    // queued 但未启动：直接取消
    await this.db
      .update(backtestRuns)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(backtestRuns.id, runId));
    return this.getRun(userId, runId);
  }

  async pause(userId: number, runId: number): Promise<BacktestRun | null> {
    const run = await this.getRun(userId, runId);
    if (!run || run.status !== "running") return run;
    const control = activeControls.get(runId);
    if (control) control.pause = true;
    return this.getRun(userId, runId);
  }

  async resume(userId: number, runId: number): Promise<BacktestRun | null> {
    const run = await this.getRun(userId, runId);
    if (!run || run.status !== "paused") return run;
    await this.db
      .update(backtestRuns)
      .set({ status: "queued", progressProcessed: 0, startedAt: null })
      .where(eq(backtestRuns.id, runId));
    void this.execute(runId, userId, run.params as BacktestInput);
    return this.getRun(userId, runId);
  }
}
