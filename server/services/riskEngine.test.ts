import { describe, expect, it } from "vitest";
import { evaluateOrderRisk, computeRealizedLoss, type AccountSnapshot, type OrderIntent } from "./riskEngine";
import type { RiskConfig } from "../../drizzle/schema";

const baseConfig: RiskConfig = {
  id: 1,
  userId: 1,
  maxPositionSize: "10000",
  maxTotalExposure: "50000",
  maxOrderQuantity: 1000,
  maxDailyTrades: 20,
  maxDailyLoss: "2000",
  minAccountBalance: "5000",
  stopLossPercent: "2",
  takeProfitPercent: "5",
  enableAutoTrading: false,
  tradingHalted: false,
  haltReason: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const NOW = new Date("2026-09-08T12:00:00Z");

function makeSnapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    availableCash: 100000,
    positions: [],
    todayOrderCount: 0,
    todayRealizedLoss: 0,
    referencePrice: 100,
    referencePriceAt: NOW,
    snapshotAt: NOW,
    ...overrides,
  };
}

function buyIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return { symbol: "AAPL.US", side: "buy", orderType: "market", quantity: 10, ...overrides };
}

describe("riskEngine.evaluateOrderRisk", () => {
  it("正常小额买入通过", () => {
    const r = evaluateOrderRisk(buyIntent(), makeSnapshot(), baseConfig, { now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("kill switch 暂停时拒绝一切", () => {
    const r = evaluateOrderRisk(buyIntent(), makeSnapshot(), { ...baseConfig, tradingHalted: true }, { now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.violations[0]).toContain("kill switch");
  });

  it.each([
    ["数量为 0", { quantity: 0 }],
    ["数量为负", { quantity: -5 }],
    ["数量 NaN", { quantity: NaN }],
    ["数量非整数", { quantity: 1.5 }],
    ["数量超大", { quantity: 2_000_000 }],
  ])("拒绝非法输入: %s", (_label, patch) => {
    const r = evaluateOrderRisk(buyIntent(patch), makeSnapshot(), baseConfig, { now: NOW });
    expect(r.allowed).toBe(false);
  });

  it("限价单缺限价/负限价被拒绝", () => {
    expect(
      evaluateOrderRisk(buyIntent({ orderType: "limit" }), makeSnapshot(), baseConfig, { now: NOW }).allowed
    ).toBe(false);
    expect(
      evaluateOrderRisk(buyIntent({ orderType: "limit", limitPrice: -1 }), makeSnapshot(), baseConfig, { now: NOW })
        .allowed
    ).toBe(false);
  });

  it("参考价缺失 fail closed", () => {
    const r = evaluateOrderRisk(
      buyIntent(),
      makeSnapshot({ referencePrice: null, referencePriceAt: null }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("参考价");
  });

  it("参考价过期 fail closed", () => {
    const stale = new Date(NOW.getTime() - 60 * 60 * 1000);
    const r = evaluateOrderRisk(
      buyIntent(),
      makeSnapshot({ referencePriceAt: stale }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("过期");
  });

  it("现金未知 fail closed", () => {
    const r = evaluateOrderRisk(buyIntent(), makeSnapshot({ availableCash: null }), baseConfig, { now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("现金未知");
  });

  it("现金不足拒绝", () => {
    const r = evaluateOrderRisk(
      buyIntent({ quantity: 500 }), // 500 * 100 = 50000
      makeSnapshot({ availableCash: 1000 }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("现金不足");
  });

  it("剩余现金不得低于最小保留余额", () => {
    // 现金 10500，订单 6000 → 剩 4500 < 5000
    const r = evaluateOrderRisk(
      buyIntent({ quantity: 60 }),
      makeSnapshot({ availableCash: 10500 }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("最小保留余额");
  });

  it("卖出无持仓拒绝", () => {
    const r = evaluateOrderRisk(buyIntent({ side: "sell" }), makeSnapshot(), baseConfig, { now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("可卖持仓");
  });

  it("卖出超过可用数量拒绝", () => {
    const r = evaluateOrderRisk(
      buyIntent({ side: "sell", quantity: 50 }),
      makeSnapshot({
        positions: [{ symbol: "AAPL.US", quantity: 100, availableQuantity: 30, marketValue: 10000, avgPrice: 90 }],
      }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("可卖数量不足");
  });

  it("卖出在可用数量内通过", () => {
    const r = evaluateOrderRisk(
      buyIntent({ side: "sell", quantity: 30 }),
      makeSnapshot({
        positions: [{ symbol: "AAPL.US", quantity: 100, availableQuantity: 30, marketValue: 10000, avgPrice: 90 }],
      }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(true);
  });

  it("单笔数量上限", () => {
    const r = evaluateOrderRisk(buyIntent({ quantity: 1001 }), makeSnapshot(), baseConfig, { now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("单笔数量超限");
  });

  it("单标的暴露超限拒绝", () => {
    const r = evaluateOrderRisk(
      buyIntent({ quantity: 10 }), // +1000
      makeSnapshot({
        positions: [{ symbol: "AAPL.US", quantity: 95, availableQuantity: 95, marketValue: 9500, avgPrice: 100 }],
      }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("单标的暴露超限");
  });

  it("总暴露超限拒绝", () => {
    const r = evaluateOrderRisk(
      buyIntent({ quantity: 10 }),
      makeSnapshot({
        positions: [
          { symbol: "MSFT.US", quantity: 495, availableQuantity: 495, marketValue: 49500, avgPrice: 100 },
        ],
      }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("总暴露超限");
  });

  it("持仓市值未知 fail closed", () => {
    const r = evaluateOrderRisk(
      buyIntent(),
      makeSnapshot({
        positions: [{ symbol: "MSFT.US", quantity: 10, availableQuantity: 10, marketValue: null, avgPrice: null }],
      }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("市值未知");
  });

  it("日交易次数达上限拒绝", () => {
    const r = evaluateOrderRisk(buyIntent(), makeSnapshot({ todayOrderCount: 20 }), baseConfig, { now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("当日交易次数");
  });

  it("日亏损熔断", () => {
    const r = evaluateOrderRisk(
      buyIntent(),
      makeSnapshot({ todayRealizedLoss: 2000 }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.join()).toContain("亏损熔断");
  });

  it("多个违规同时报告", () => {
    const r = evaluateOrderRisk(
      buyIntent({ quantity: 1001 }),
      makeSnapshot({ availableCash: null, todayOrderCount: 25 }),
      baseConfig,
      { now: NOW }
    );
    expect(r.allowed).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
  });
});

describe("riskEngine.computeRealizedLoss", () => {
  it("卖出盈利不产生亏损", () => {
    expect(
      computeRealizedLoss([{ side: "sell", quantity: 10, price: 110, costBasis: 100 }])
    ).toBe(0);
  });

  it("卖出亏损累计", () => {
    expect(
      computeRealizedLoss([
        { side: "sell", quantity: 10, price: 90, costBasis: 100 }, // -100
        { side: "sell", quantity: 5, price: 80, costBasis: 100 }, // -100
        { side: "buy", quantity: 5, price: 80, costBasis: null },
      ])
    ).toBe(200);
  });

  it("成本未知的卖出不计入", () => {
    expect(computeRealizedLoss([{ side: "sell", quantity: 10, price: 90, costBasis: null }])).toBe(0);
  });
});
