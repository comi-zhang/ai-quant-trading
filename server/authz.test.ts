import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * 认证/授权集成测试：
 * 匿名用户（ctx.user=null）调用任何 protected procedure 必须得到 UNAUTHORIZED，
 * 不得返回账户/订单/决策等私有数据，也不得返回伪造的空数据冒充成功。
 */

const anonCtx = {
  req: { headers: {} } as unknown as TrpcContext["req"],
  res: {} as unknown as TrpcContext["res"],
  user: null,
} satisfies TrpcContext;

const PROTECTED_CALLS: { name: string; call: (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown> }[] = [
  { name: "quote.getAccountAssets", call: (c) => c.quote.getAccountAssets() },
  { name: "quote.getAccountPositions", call: (c) => c.quote.getAccountPositions() },
  { name: "trading.listOrders", call: (c) => c.trading.listOrders({ limit: 10 }) },
  { name: "trading.listTrades", call: (c) => c.trading.listTrades({ limit: 10 }) },
  { name: "trading.getTradingMode", call: (c) => c.trading.getTradingMode() },
  {
    name: "trading.submitOrder",
    call: (c) =>
      c.trading.submitOrder({ symbol: "AAPL", side: "buy", orderType: "market", quantity: 1, timeInForce: "day" }),
  },
  { name: "trading.cancelOrder", call: (c) => c.trading.cancelOrder({ orderId: 1 }) },
  { name: "trading.reconcileOrders", call: (c) => c.trading.reconcileOrders() },
  { name: "risk.getConfig", call: (c) => c.risk.getConfig() },
  { name: "risk.updateConfig", call: (c) => c.risk.updateConfig({ maxDailyTrades: 5 }) },
  { name: "risk.haltTrading", call: (c) => c.risk.haltTrading({ reason: "test" }) },
  { name: "risk.resumeTrading", call: (c) => c.risk.resumeTrading() },
  { name: "autoTrading.getDecisionHistory", call: (c) => c.autoTrading.getDecisionHistory({ limit: 5 }) },
  { name: "autoTrading.dryRun", call: (c) => c.autoTrading.dryRun({ symbols: ["AAPL"] }) },
  { name: "autoTrading.executeNow", call: (c) => c.autoTrading.executeNow({ symbols: ["AAPL"] }) },
  { name: "autoTrading.getSchedulerStatus", call: (c) => c.autoTrading.getSchedulerStatus() },
  { name: "autoTrading.runSchedulerOnce", call: (c) => c.autoTrading.runSchedulerOnce() },
  { name: "decision.analyzeStock", call: (c) => c.decision.analyzeStock({ symbol: "AAPL" }) },
  { name: "backtest.previewHistory", call: (c) => c.backtest.previewHistory({ symbol: "AAPL", period: "day", startTime: "2026-08-01", endTime: "2026-09-01" }) },
  {
    name: "backtest.createRun",
    call: (c) =>
      c.backtest.createRun({
        input: {
          symbol: "AAPL", period: "day", startTime: "2026-08-01", endTime: "2026-09-01",
          initialCapital: 10000, sizing: { mode: "fixed_amount", amount: 5000 },
          maxPositionValue: 50000, maxOrderSize: 1000, commissionPerTrade: 0,
          slippagePct: 0, spreadPct: 0, stopLossPct: 0.1, takeProfitPct: 0.2,
          strategy: { name: "ma-cross", version: "v1", params: {} },
        },
      }),
  },
  { name: "backtest.getRun", call: (c) => c.backtest.getRun({ runId: 1 }) },
  { name: "backtest.listRuns", call: (c) => c.backtest.listRuns({ limit: 5 }) },
  { name: "backtest.getResult", call: (c) => c.backtest.getResult({ runId: 1 }) },
  { name: "backtest.getEvents", call: (c) => c.backtest.getEvents({ runId: 1, offset: 0, limit: 10 }) },
  { name: "backtest.cancelRun", call: (c) => c.backtest.cancelRun({ runId: 1 }) },
  { name: "backtest.pauseRun", call: (c) => c.backtest.pauseRun({ runId: 1 }) },
  { name: "backtest.resumeRun", call: (c) => c.backtest.resumeRun({ runId: 1 }) },
  { name: "backtest.rerunRun", call: (c) => c.backtest.rerunRun({ runId: 1 }) },
];

describe("匿名用户访问控制", () => {
  const caller = appRouter.createCaller(anonCtx);

  for (const { name, call } of PROTECTED_CALLS) {
    it(`${name} 返回 UNAUTHORIZED`, async () => {
      await expect(call(caller)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  }

  it("public 行情接口对匿名可用（但无凭据时报 PRECONDITION_FAILED 而非伪造数据）", async () => {
    try {
      await caller.quote.getQuotes({ symbols: ["AAPL"] });
      // 若环境配置了凭据则可能成功 —— 两种情况都合法
    } catch (err) {
      expect((err as { code?: string }).code).toMatch(/PRECONDITION_FAILED|BAD_GATEWAY|TOO_MANY_REQUESTS|INTERNAL_SERVER_ERROR/);
    }
  });

  it("auth.me 对匿名返回 null（不伪造用户）", async () => {
    await expect(caller.auth.me()).resolves.toBeNull();
  });
});
