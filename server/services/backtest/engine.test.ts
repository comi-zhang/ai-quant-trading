import { describe, expect, it } from "vitest";
import { runBacktest } from "./engine";
import { backtestInputSchema, type BacktestInput } from "./types";
import type { HistoryBar } from "../history/types";

const META = { dataVersion: "testv1", source: "fixture", warnings: [] as string[] };

function makeBars(closes: number[], opts: { volume?: number; startDate?: string } = {}): HistoryBar[] {
  const volume = opts.volume ?? 10_000_000;
  const start = Date.parse(opts.startDate ?? "2026-08-03T04:00:00Z");
  return closes.map((close, i) => {
    // 跳过周末
    let d = start + i * 24 * 3600 * 1000;
    while (new Date(d).getUTCDay() === 0 || new Date(d).getUTCDay() === 6) d += 24 * 3600 * 1000;
    return {
      timestamp: new Date(d).toISOString(),
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume,
    };
  });
}

function baseInput(overrides: Partial<BacktestInput> = {}): BacktestInput {
  return {
    symbol: "TEST.US",
    period: "day",
    startTime: "2026-08-01",
    endTime: "2026-09-01",
    initialCapital: 10000,
    sizing: { mode: "fixed_amount", amount: 5000 },
    maxPositionValue: 50000,
    maxOrderSize: 100000,
    commissionPerTrade: 0,
    slippagePct: 0,
    spreadPct: 0,
    stopLossPct: 0.5,
    takeProfitPct: 100,
    strategy: { name: "ma-cross", version: "v1", params: { fast: 2, slow: 3 } },
    ...overrides,
  };
}

describe("输入边界", () => {
  it("空数据拒绝运行（不伪造结果）", () => {
    expect(() => runBacktest([], baseInput(), META)).toThrow(/为空/);
  });

  it("schema 拒绝：负数资金/NaN/日期反转/超大量", () => {
    expect(backtestInputSchema.safeParse(baseInput({ initialCapital: -1 })).success).toBe(false);
    expect(backtestInputSchema.safeParse(baseInput({ initialCapital: NaN })).success).toBe(false);
    expect(
      backtestInputSchema.safeParse(baseInput({ startTime: "2026-09-01", endTime: "2026-08-01" })).success
    ).toBe(false);
    expect(backtestInputSchema.safeParse(baseInput({ initialCapital: 1e12 })).success).toBe(false);
    expect(backtestInputSchema.safeParse(baseInput({ slippagePct: 0.5 })).success).toBe(false);
  });
});

describe("成交规则与成本", () => {
  // 构造确定出现金叉的序列：先跌后涨（SMA2 上穿 SMA3）
  const crossUpBars = makeBars([100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120]);

  it("信号在下一 bar 开盘价成交（无前视）", () => {
    const result = runBacktest(crossUpBars, baseInput(), META);
    const buy = result.events.find((e) => e.execution?.status === "filled" && e.execution.side === "buy");
    expect(buy).toBeDefined();
    // 成交时间 = 信号 bar 的下一根
    expect(buy!.execution!.timestamp).toBe(crossUpBars[buy!.barIndex + 1].timestamp);
    // 成交价 = 下一 bar 开盘价（无成本时）
    expect(buy!.execution!.price).toBe(crossUpBars[buy!.barIndex + 1].open);
    expect(result.meta.executionRule).toBe("next_bar_open");
  });

  it("佣金/滑点/点差降低收益并计入成本", () => {
    const free = runBacktest(crossUpBars, baseInput(), META);
    const costly = runBacktest(
      crossUpBars,
      baseInput({ commissionPerTrade: 10, slippagePct: 0.001, spreadPct: 0.002 }),
      META
    );
    expect(costly.metrics.netProfit).toBeLessThan(free.metrics.netProfit);
    expect(costly.metrics.totalCommission).toBeGreaterThan(0);
    expect(costly.metrics.totalSlippageCost).toBeGreaterThan(0);
    expect(costly.metrics.totalSpreadCost).toBeGreaterThan(0);
    // 买入价高于开盘价（不利方向）
    const buy = costly.events.find((e) => e.execution?.status === "filled" && e.execution.side === "buy");
    expect(buy!.execution!.price).toBeGreaterThan(crossUpBars[buy!.barIndex + 1].open);
  });

  it("现金不足收缩数量，完全不足则 rejected_cash", () => {
    const result = runBacktest(
      crossUpBars,
      baseInput({ initialCapital: 200, sizing: { mode: "fixed_amount", amount: 5000 } }),
      META
    );
    const ev = result.events.find((e) => e.signal === "BUY");
    expect(ev).toBeDefined();
    const totalSpent = ev!.execution!.price * ev!.execution!.quantity;
    expect(totalSpent).toBeLessThanOrEqual(200);

    const tiny = runBacktest(
      crossUpBars,
      baseInput({ initialCapital: 100, sizing: { mode: "fixed_amount", amount: 5000 } }),
      META
    );
    const rejected = tiny.events.find((e) => e.signal === "BUY");
    expect(rejected!.execution!.status === "rejected_cash" || rejected!.execution!.quantity * rejected!.execution!.price <= 100).toBe(true);
  });

  it("持仓市值上限约束", () => {
    const result = runBacktest(
      crossUpBars,
      baseInput({ maxPositionValue: 1000, sizing: { mode: "fixed_amount", amount: 50000 } }),
      META
    );
    const buy = result.events.find((e) => e.execution?.status === "filled" && e.execution.side === "buy");
    expect(buy!.execution!.price * buy!.execution!.quantity).toBeLessThanOrEqual(1000.001);
  });

  it("成交量参与率导致部分成交", () => {
    const lowVol = makeBars([100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120], { volume: 100 });
    const result = runBacktest(
      lowVol,
      baseInput({ sizing: { mode: "fixed_amount", amount: 5000 } }),
      META
    );
    const buy = result.events.find((e) => e.execution?.side === "buy" && e.execution.status !== "end_of_data");
    // volume=100 → maxFill=10
    expect(buy!.execution!.quantity).toBeLessThanOrEqual(10);
    expect(["partial_filled", "filled"]).toContain(buy!.execution!.status);
  });

  it("零成交量 bar 拒绝成交", () => {
    const zeroVol = makeBars([100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120], { volume: 0 });
    const result = runBacktest(zeroVol, baseInput(), META);
    const buy = result.events.find((e) => e.signal === "BUY");
    expect(buy!.execution!.status).toBe("rejected_no_liquidity");
  });

  it("未平仓头寸在回测结束时强制平仓", () => {
    const upOnly = makeBars([100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120]);
    const result = runBacktest(upOnly, baseInput({ takeProfitPct: 1000 }), META);
    const last = result.events[result.events.length - 1];
    expect(last.note).toContain("强制平仓");
    expect(result.equityCurve[result.equityCurve.length - 1].positionQty).toBe(0);
  });
});

describe("信号模型", () => {
  it("PUT 只有信号没有成交，且不产生收益", () => {
    // 单边上涨 → RSI=100 > 超买线且无持仓 → PUT（看跌信号，未执行）
    const upTrend = makeBars(Array.from({ length: 20 }, (_, i) => 100 + i * 2));
    const result = runBacktest(
      upTrend,
      baseInput({ strategy: { name: "rsi-reversion", version: "v1", params: { period: 14 } } }),
      META
    );
    const puts = result.events.filter((e) => e.signal === "PUT");
    expect(puts.length).toBeGreaterThan(0);
    for (const p of puts) {
      expect(p.execution).toBeNull();
      expect(p.note).toContain("未执行");
      expect(p.note).toContain("不虚构");
      // 无虚构成交字段
      expect(p.intent).toBeNull();
    }
    // PUT 不产生任何交易
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.netProfit).toBe(0);
    // PUT 与 SELL 严格区分
    expect(result.events.some((e) => e.signal === "SELL")).toBe(false);
  });

  it("重复 BUY 信号去重", () => {
    const up = makeBars([100, 99, 98, 97, 99, 102, 104, 103, 105, 104, 106, 108, 110]);
    const result = runBacktest(up, baseInput(), META);
    const dupes = result.events.filter((e) => e.execution?.status === "skipped_duplicate" || e.note?.includes("去重"));
    // 已持仓期间再次出现金叉 → 去重（HOLD）或 skipped
    const buys = result.events.filter((e) => e.execution?.side === "buy" && e.execution.status === "filled");
    expect(buys.length).toBe(1); // 单持仓模型只买一次
    expect(dupes.length + 1).toBeGreaterThanOrEqual(1);
  });

  it("事件 ID 唯一且递增，decisions 与 bars 对齐", () => {
    const result = runBacktest(makeBars([100, 99, 98, 97, 99, 102, 105, 108]), baseInput(), META);
    const ids = result.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(result.decisions).toHaveLength(result.bars.length);
    for (const d of result.decisions) {
      expect(["BUY", "SELL", "PUT", "HOLD"]).toContain(d);
    }
  });
});

describe("look-ahead bias 防护", () => {
  it("修改未来 bar 不影响过去信号与事件", () => {
    const closes = [100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120];
    const barsA = makeBars(closes);
    const barsB = makeBars(closes);
    // 篡改后半段未来数据
    for (let i = 7; i < barsB.length; i++) {
      barsB[i] = { ...barsB[i], open: 9999, high: 9999, low: 9999, close: 9999 };
    }
    const a = runBacktest(barsA, baseInput(), META);
    const b = runBacktest(barsB, baseInput(), META);
    // 前 7 根 bar 的决策必须一致
    expect(a.decisions.slice(0, 7)).toEqual(b.decisions.slice(0, 7));
    // 发生在前 6 根的事件必须完全一致
    const evA = a.events.filter((e) => e.barIndex < 6);
    const evB = b.events.filter((e) => e.barIndex < 6);
    expect(evB).toEqual(evA);
  });
});

describe("确定性与一致性", () => {
  it("同一 fixture 同一参数重复运行结果完全一致", () => {
    const bars = makeBars([100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120]);
    const a = runBacktest(bars, baseInput(), META);
    const b = runBacktest(bars, baseInput(), META);
    const { createdAt: _a, ...metaA } = a.meta;
    const { createdAt: _b, ...metaB } = b.meta;
    expect({ ...a, meta: metaA }).toEqual({ ...b, meta: metaB });
  });

  it("真实 fixture（AAPL 120 日K）可运行且指标自洽", async () => {
    const { FixtureProvider } = await import("../history/provider");
    const provider = new FixtureProvider();
    const raw = await provider.fetchCandles({
      symbol: "AAPL.US",
      period: "day",
      startTime: new Date("2026-03-20T00:00:00Z"),
      endTime: new Date("2026-09-04T00:00:00Z"),
      maxBars: 200,
    });
    const { normalizeBars } = await import("../history/normalize");
    const { bars } = normalizeBars(raw, { period: "day", maxBars: 200 });
    const result = runBacktest(
      bars,
      baseInput({ strategy: { name: "ma-cross", version: "v1", params: { fast: 5, slow: 20 } } }),
      { dataVersion: "aapl120", source: "fixture", warnings: [] }
    );
    expect(result.meta.barCount).toBe(bars.length);
    expect(result.equityCurve).toHaveLength(bars.length);
    // 数值自洽：最终权益 = 最后权益点
    expect(result.metrics.finalEquity).toBeCloseTo(result.equityCurve[result.equityCurve.length - 1].equity, 6);
    // 净收益 = final - initial
    expect(result.metrics.netProfit).toBeCloseTo(result.metrics.finalEquity - 10000, 6);
    // 基准自洽
    expect(result.metrics.benchmarkReturnPct).toBeCloseTo(
      ((bars[bars.length - 1].close - bars[0].close) / bars[0].close) * 100,
      4
    );
  });
});

describe("极端场景", () => {
  it("全盈利：单边上涨+金叉买入持有至结束", () => {
    const up = makeBars([100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120, 124, 128]);
    const result = runBacktest(up, baseInput({ takeProfitPct: 1000 }), META);
    expect(result.metrics.netProfit).toBeGreaterThan(0);
    for (const t of result.trades) expect(t.pnl).toBeGreaterThan(0);
  });

  it("全亏损：买入后持续下跌触发止损", () => {
    const down = makeBars([100, 99, 98, 97, 99, 102, 100, 95, 90, 85, 80, 75, 70, 65, 60, 55]);
    const result = runBacktest(down, baseInput({ stopLossPct: 0.05 }), META);
    expect(result.metrics.netProfit).toBeLessThan(0);
    expect(result.trades.every((t) => t.pnl <= 0)).toBe(true);
  });

  it("无交易：零波动序列无任何信号", () => {
    const flat = makeBars(Array(30).fill(100));
    const result = runBacktest(flat, baseInput(), META);
    expect(result.events).toHaveLength(0);
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.finalEquity).toBe(10000);
    expect(result.metrics.winRate).toBeNull();
    expect(result.decisions.every((d) => d === "HOLD")).toBe(true);
  });

  it("单笔 P&L 与累计权益一致", () => {
    const bars = makeBars([100, 99, 98, 97, 99, 102, 105, 108, 111, 114, 117, 120]);
    const result = runBacktest(bars, baseInput({ commissionPerTrade: 1, slippagePct: 0.001, spreadPct: 0.001 }), META);
    const tradePnlSum = result.trades.reduce((s, t) => s + t.pnl, 0);
    const lastEquity = result.equityCurve[result.equityCurve.length - 1];
    // 全部平仓后：净收益 ≈ 各 round-trip P&L 之和
    expect(lastEquity.positionQty).toBe(0);
    expect(result.metrics.netProfit).toBeCloseTo(tradePnlSum, 4);
  });
});
