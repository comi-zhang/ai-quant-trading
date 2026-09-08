import { and, eq, sql } from "drizzle-orm";
import { jobRuns } from "../../drizzle/schema";
import { getDb, type Db } from "../db";
import { ENV } from "../_core/env";
import { isAutoTradingEnabled } from "../services/tradingMode";
import { AutoTradingStrategy, type StrategyExecutionResult } from "../services/autoTradingStrategy";
import { getOrderService } from "../services/orderService";

/**
 * 自动交易调度器（重写）
 *
 * 与旧版差异：
 * - 不再有固定 50 分/固定目标价/假新闻：分析走 AutoTradingStrategy 真实数据链；
 * - 互斥：进程内锁 + job_runs 租约（防止重入/多实例并发）；
 * - 固定顺序：read-only analysis -> persist decision -> paper execution -> reconcile -> report；
 * - 有超时、重试上限、指数退避、优雅关闭；
 * - 默认不启动：只有 AUTO_TRADING_ENABLED=true 且显式调用 start() 才运行。
 */

export interface SchedulerOptions {
  intervalMs?: number;
  jobTimeoutMs?: number;
  leaseMs?: number;
  symbols?: string[];
  /** 是否在 job 中执行订单（默认 false：只读分析 + 对账） */
  executeOrders?: boolean;
  maxConsecutiveFailures?: number;
}

interface JobContext {
  db: Db;
  jobRunId: number;
}

export class AutoTradingScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false; // 进程内互斥锁
  private stopped = true;
  private consecutiveFailures = 0;
  private readonly opts: Required<SchedulerOptions>;

  constructor(opts: SchedulerOptions = {}) {
    this.opts = {
      intervalMs: opts.intervalMs ?? 5 * 60 * 1000,
      jobTimeoutMs: opts.jobTimeoutMs ?? 2 * 60 * 1000,
      leaseMs: opts.leaseMs ?? 3 * 60 * 1000,
      symbols: opts.symbols ?? ["AAPL", "MSFT", "TSLA"],
      executeOrders: opts.executeOrders ?? false,
      maxConsecutiveFailures: opts.maxConsecutiveFailures ?? 5,
    };
  }

  get isRunning(): boolean {
    return !this.stopped;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // 链式 setTimeout（非 setInterval）：上一次完成后才排下一次，天然防重入
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.runOnce();
      } catch (err) {
        console.error("[Scheduler] job 异常:", (err as Error).message);
      }
      if (!this.stopped) {
        // 连续失败指数退避
        const backoff = Math.min(
          this.opts.intervalMs * 2 ** Math.max(0, this.consecutiveFailures - 1),
          30 * 60 * 1000
        );
        this.timer = setTimeout(tick, this.consecutiveFailures > 0 ? backoff : this.opts.intervalMs);
      }
    };
    this.timer = setTimeout(tick, 0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // 等待进行中的 job 结束（最多 10s）
    const deadline = Date.now() + 10_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** 租约：同 jobName 只允许一个 running 且未过期的记录 */
  private async acquireLease(db: Db, jobName: string): Promise<number | null> {
    const owner = `pid-${process.pid}`;
    const now = new Date();
    // 清理过期租约
    await db
      .update(jobRuns)
      .set({ status: "failed", error: "lease expired (stale runner)", finishedAt: now })
      .where(
        and(
          eq(jobRuns.jobName, jobName),
          eq(jobRuns.status, "running"),
          sql`${jobRuns.leaseExpiresAt} < now()`
        )
      );
    const existing = await db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.jobName, jobName), eq(jobRuns.status, "running")))
      .limit(1);
    if (existing.length > 0) return null; // 已被其他实例持有
    const inserted = await db
      .insert(jobRuns)
      .values({
        jobName,
        status: "running",
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + this.opts.leaseMs),
        startedAt: now,
      })
      .returning();
    return inserted[0]?.id ?? null;
  }

  private async releaseLease(db: Db, id: number, ok: boolean, stats: unknown, error?: string) {
    await db
      .update(jobRuns)
      .set({
        status: ok ? "success" : "failed",
        stats: stats ?? null,
        error: error ?? null,
        finishedAt: new Date(),
      })
      .where(eq(jobRuns.id, id));
  }

  /** 执行一次完整 job（可被单测直接调用） */
  async runOnce(userId?: number): Promise<StrategyExecutionResult[] | null> {
    if (this.running) {
      console.warn("[Scheduler] 上一次 job 仍在运行，跳过");
      return null;
    }
    if (!isAutoTradingEnabled()) {
      console.warn("[Scheduler] AUTO_TRADING_ENABLED=false，跳过");
      return null;
    }

    const db = await getDb();
    if (!db) {
      console.error("[Scheduler] 数据库不可用，跳过");
      return null;
    }

    this.running = true;
    const jobName = "auto-trading";
    let jobRunId: number | null = null;

    try {
      jobRunId = await this.acquireLease(db, jobName);
      if (jobRunId === null) {
        console.warn("[Scheduler] 租约被占用，跳过本轮");
        return null;
      }

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("job timeout")), this.opts.jobTimeoutMs)
      );

      const work = async (): Promise<StrategyExecutionResult[]> => {
        // 需要用户上下文：自动交易归属 OWNER_OPEN_ID 对应用户（单用户系统）
        const targetUserId = userId ?? (await this.resolveOwnerUserId(db));
        if (targetUserId === null) throw new Error("未找到自动交易归属用户");

        const strategy = new AutoTradingStrategy();
        const results: StrategyExecutionResult[] = [];
        // 固定顺序：analysis -> persist -> (paper) execution
        for (const symbol of this.opts.symbols) {
          const r = await strategy.runForSymbol(targetUserId, symbol, {
            execute: this.opts.executeOrders,
            jobRunId: jobRunId ?? undefined,
          });
          results.push(r);
        }
        // reconcile
        const service = await getOrderService();
        if (service) await service.reconcileOpenOrders(targetUserId);
        return results;
      };

      const results = await Promise.race([work(), timeout]);
      await this.releaseLease(db, jobRunId, true, {
        symbols: this.opts.symbols,
        executed: results.filter((r) => r.executed).length,
        qualities: results.map((r) => r.dataQuality),
      });
      this.consecutiveFailures = 0;
      return results;
    } catch (err) {
      this.consecutiveFailures++;
      if (jobRunId !== null) {
        await this.releaseLease(db, jobRunId, false, null, (err as Error).message).catch(() => undefined);
      }
      if (this.consecutiveFailures >= this.opts.maxConsecutiveFailures) {
        console.error(`[Scheduler] 连续失败 ${this.consecutiveFailures} 次，停止调度（需人工介入）`);
        await this.stop();
      }
      return null;
    } finally {
      this.running = false;
    }
  }

  private async resolveOwnerUserId(db: Db): Promise<number | null> {
    const { users } = await import("../../drizzle/schema");
    const openId = ENV.ownerOpenId;
    if (openId) {
      const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (rows[0]) return rows[0].id;
    }
    // 单用户系统兜底：取第一个用户
    const anyUser = await db.select().from(users).limit(1);
    return anyUser[0]?.id ?? null;
  }
}

export const autoTradingScheduler = new AutoTradingScheduler();
