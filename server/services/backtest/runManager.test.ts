import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import { backtestRuns, users } from "../../../drizzle/schema";
import type { Db } from "../../db";
import { BacktestRunManager, computeIdempotencyKey } from "./runManager";
import { HistoryService } from "../history/service";
import { FixtureProvider } from "../history/provider";
import type { BacktestInput } from "./types";

/**
 * 回测 run 管理集成测试（PGlite 真实迁移 + fixture 数据源）
 */

let pg: PGlite;
let db: Db;
let manager: BacktestRunManager;
let userId: number;

const FIXTURE_INPUT: BacktestInput = {
  symbol: "AAPL",
  period: "day",
  startTime: "2026-06-01",
  endTime: "2026-09-01",
  source: "fixture",
  initialCapital: 10000,
  sizing: { mode: "capital_pct", pct: 0.5 },
  maxPositionValue: 50000,
  maxOrderSize: 100000,
  commissionPerTrade: 1,
  slippagePct: 0.0005,
  spreadPct: 0.0005,
  stopLossPct: 0.1,
  takeProfitPct: 0.2,
  strategy: { name: "ma-cross", version: "v1", params: { fast: 5, slow: 20 } },
};

async function waitForStatus(runId: number, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.select().from(backtestRuns).where(eq(backtestRuns.id, runId));
    const status = rows[0]?.status;
    if (status === "completed" || status === "failed" || status === "cancelled") return status;
    if (Date.now() > deadline) throw new Error(`等待 run ${runId} 完成超时（当前: ${status}）`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "drizzle" });
  const [u] = await db.insert(users).values({ openId: "bt-user", name: "t" }).returning();
  userId = u.id;
  const history = new HistoryService({ fixtureProvider: new FixtureProvider() });
  manager = new BacktestRunManager({ db, history });
}, 60000);

afterAll(async () => {
  await pg.close();
});

describe("BacktestRunManager", () => {
  it("createRun 执行完成并持久化结果", async () => {
    const run = await manager.createRun(userId, FIXTURE_INPUT);
    expect(run.status === "queued" || run.status === "running" || run.status === "completed").toBe(true);
    const status = await waitForStatus(run.id);
    expect(status).toBe("completed");

    const result = await manager.getResult(userId, run.id);
    expect(result).not.toBeNull();
    expect(result!.meta.barCount).toBeGreaterThan(0);
    expect(result!.meta.dataSource).toBe("fixture");
    expect(result!.meta.executionRule).toBe("next_bar_open");
    expect(result!.events.length).toBeGreaterThanOrEqual(0);
    expect(result!.metrics.finalEquity).toBeGreaterThan(0);

    const final = await manager.getRun(userId, run.id);
    expect(final!.progressProcessed).toBe(final!.progressTotal);
    expect(final!.dataVersion).toMatch(/^[0-9a-f]{12}$/);
  });

  it("幂等：相同输入重复 create 返回同一 run，不重复执行", async () => {
    const key = computeIdempotencyKey(FIXTURE_INPUT);
    const a = await manager.createRun(userId, FIXTURE_INPUT, key);
    const b = await manager.createRun(userId, FIXTURE_INPUT, key);
    expect(a.id).toBe(b.id);
  });

  it("rerun 创建新 run（链接 parent，不覆盖旧结果）", async () => {
    const key = computeIdempotencyKey(FIXTURE_INPUT);
    const original = await manager.createRun(userId, FIXTURE_INPUT, key);
    await waitForStatus(original.id);
    const rerun = await manager.rerun(userId, original.id);
    expect(rerun).not.toBeNull();
    expect(rerun!.id).not.toBe(original.id);
    expect(rerun!.parentRunId).toBe(original.id);
    const status = await waitForStatus(rerun!.id);
    expect(status).toBe("completed");
    // 旧结果仍在
    const oldResult = await manager.getResult(userId, original.id);
    expect(oldResult).not.toBeNull();
    // 确定性：同数据同参数 → 指标一致
    const newResult = await manager.getResult(userId, rerun!.id);
    expect(newResult!.metrics).toEqual(oldResult!.metrics);
  });

  it("取消 queued run", async () => {
    const input = { ...FIXTURE_INPUT, startTime: "2026-03-20", endTime: "2026-04-01" };
    const key = `cancel-test-${Date.now()}`;
    const run = await manager.createRun(userId, input, key);
    const cancelled = await manager.cancel(userId, run.id);
    expect(cancelled).not.toBeNull();
    const final = await waitForStatus(run.id).catch(() => "cancelled");
    const row = await manager.getRun(userId, run.id);
    expect(["cancelled", "completed"].includes(row!.status)).toBe(true);
    if (row!.status === "cancelled") {
      expect(await manager.getResult(userId, run.id)).toBeNull();
    }
  });

  it("崩溃恢复：中断的 run 标记 failed 而非 completed", async () => {
    const [stuck] = await db
      .insert(backtestRuns)
      .values({
        userId,
        idempotencyKey: `stuck-${Date.now()}`,
        params: FIXTURE_INPUT,
        status: "running",
        progressProcessed: 10,
        progressTotal: 100,
      })
      .returning();
    const recovered = await manager.recoverInterruptedRuns();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const row = await manager.getRun(userId, stuck.id);
    expect(row!.status).toBe("failed");
    expect(row!.error).toContain("中断");
    expect(await manager.getResult(userId, stuck.id)).toBeNull();
  });

  it("数据为空时 run failed 且不产生结果", async () => {
    const empty = { ...FIXTURE_INPUT, startTime: "2020-01-01", endTime: "2020-02-01" };
    const run = await manager.createRun(userId, empty, `empty-${Date.now()}`);
    const status = await waitForStatus(run.id);
    expect(status).toBe("failed");
    const row = await manager.getRun(userId, run.id);
    expect(row!.error).toBeTruthy();
  });

  it("listRuns 按时间倒序", async () => {
    const runs = await manager.listRuns(userId, 5);
    expect(runs.length).toBeGreaterThan(0);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(runs[i].createdAt.getTime());
    }
  });

  it("用户隔离：其他用户看不到该 run", async () => {
    const [u2] = await db.insert(users).values({ openId: "bt-user-2", name: "t2" }).returning();
    const key = computeIdempotencyKey(FIXTURE_INPUT);
    const run = await manager.createRun(userId, FIXTURE_INPUT, key);
    expect(await manager.getRun(u2.id, run.id)).toBeNull();
    expect(await manager.getResult(u2.id, run.id)).toBeNull();
  });
});
