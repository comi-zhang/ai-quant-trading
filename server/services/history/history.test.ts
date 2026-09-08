import { describe, expect, it, beforeEach } from "vitest";
import { normalizeBars } from "./normalize";
import { HistoryService, resetHistoryService, clearHistoryCache } from "./service";
import { FixtureProvider, generateSyntheticBars } from "./provider";
import { historyQuerySchema } from "./types";

const VALID_BAR = { timestamp: "2026-08-03T04:00:00Z", open: "100", high: "101", low: "99", close: "100.5", volume: "1000" };

function barAt(dayOffset: number, close = 100): Record<string, unknown> {
  const d = new Date(Date.UTC(2026, 7, 3 + dayOffset));
  return { timestamp: d.toISOString(), open: close, high: close + 1, low: close - 1, close, volume: 1000 };
}

describe("normalizeBars", () => {
  it("解析字符串数值并升序排序", () => {
    const { bars } = normalizeBars([barAt(1), barAt(0)], { period: "day", maxBars: 100 });
    expect(bars).toHaveLength(2);
    expect(bars[0].timestamp < bars[1].timestamp).toBe(true);
    expect(typeof bars[0].close).toBe("number");
  });

  it("重复时间戳去重并警告", () => {
    const { bars, warnings } = normalizeBars([barAt(0), barAt(0), barAt(1)], { period: "day", maxBars: 100 });
    expect(bars).toHaveLength(2);
    expect(warnings.join()).toContain("重复");
  });

  it("无效 bar 丢弃：负价格/high<low/NaN/缺字段", () => {
    const bad = [
      { ...VALID_BAR, close: "-5" },
      { ...VALID_BAR, timestamp: "2026-08-04T04:00:00Z", high: "90", low: "99" },
      { ...VALID_BAR, timestamp: "2026-08-05T04:00:00Z", close: "abc" },
      { timestamp: "2026-08-06T04:00:00Z", open: "100" },
      "garbage",
    ];
    const { bars, dropped, warnings } = normalizeBars([VALID_BAR, ...bad], { period: "day", maxBars: 100 });
    expect(bars).toHaveLength(1);
    expect(dropped).toBe(5);
    expect(warnings.join()).toContain("丢弃");
  });

  it("日K缺口检测（>4 自然日）", () => {
    const { warnings } = normalizeBars([barAt(0), barAt(10)], { period: "day", maxBars: 100 });
    expect(warnings.join()).toContain("缺口");
  });

  it("数量上限截断并保留最近数据", () => {
    const many = Array.from({ length: 20 }, (_, i) => barAt(i));
    const { bars, truncated, warnings } = normalizeBars(many, { period: "day", maxBars: 5 });
    expect(bars).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(bars[4].timestamp).toBe(many[19].timestamp);
    expect(warnings.join()).toContain("上限");
  });

  it("零成交量合法，负成交量丢弃", () => {
    const { bars, dropped } = normalizeBars(
      [barAt(0), { ...barAt(1), volume: 0 }, { ...barAt(2), volume: -5 }],
      { period: "day", maxBars: 100 }
    );
    expect(bars).toHaveLength(2);
    expect(dropped).toBe(1);
  });
});

describe("historyQuerySchema", () => {
  const base = { symbol: "AAPL", startTime: "2026-08-01", endTime: "2026-09-01" };

  it("合法输入通过", () => {
    expect(historyQuerySchema.safeParse(base).success).toBe(true);
  });

  it("日期反转拒绝", () => {
    const r = historyQuerySchema.safeParse({ ...base, startTime: "2026-09-01", endTime: "2026-08-01" });
    expect(r.success).toBe(false);
  });

  it("超大范围拒绝（>5年）", () => {
    const r = historyQuerySchema.safeParse({ ...base, startTime: "2020-01-01", endTime: "2026-09-01" });
    expect(r.success).toBe(false);
  });

  it("非法 period 拒绝", () => {
    const r = historyQuerySchema.safeParse({ ...base, period: "1m" });
    expect(r.success).toBe(false);
  });
});

describe("FixtureProvider 与合成序列", () => {
  it("合成序列确定性：同 symbol 同区间两次一致", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const end = new Date("2026-08-20T00:00:00Z");
    const a = generateSyntheticBars("FAKE.US", start, end);
    const b = generateSyntheticBars("FAKE.US", start, end);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(5);
  });

  it("合成序列跳过周末", () => {
    const bars = generateSyntheticBars("FAKE.US", new Date("2026-08-01T00:00:00Z"), new Date("2026-08-20T00:00:00Z"));
    for (const b of bars) {
      const dow = new Date(b.timestamp).getUTCDay();
      expect(dow === 0 || dow === 6).toBe(false);
    }
  });

  it("真实 fixture 文件可读且时间过滤正确", async () => {
    const provider = new FixtureProvider();
    const bars = await provider.fetchCandles({
      symbol: "AAPL.US",
      period: "day",
      startTime: new Date("2026-08-01T00:00:00Z"),
      endTime: new Date("2026-08-10T00:00:00Z"),
      maxBars: 100,
    });
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      const t = new Date(b.timestamp).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date("2026-08-01T00:00:00Z").getTime());
    }
  });
});

describe("HistoryService", () => {
  beforeEach(() => {
    resetHistoryService();
  });

  it("fixture 源返回带元信息的数据集", async () => {
    const service = new HistoryService({ fixtureProvider: new FixtureProvider() });
    const data = await service.getHistory({
      symbol: "AAPL",
      period: "day",
      startTime: "2026-08-01",
      endTime: "2026-08-20",
      source: "fixture",
    });
    expect(data.symbol).toBe("AAPL.US");
    expect(data.market).toBe("US");
    expect(data.source).toBe("fixture");
    expect(data.timezone).toBe("UTC");
    expect(data.dataVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(data.bars.length).toBeGreaterThan(0);
    expect(data.actualRange).not.toBeNull();
    expect(data.qualityStatus).toBe("ok");
  });

  it("空范围返回 degraded + 警告，不伪造 bar", async () => {
    const service = new HistoryService({ fixtureProvider: new FixtureProvider() });
    const data = await service.getHistory({
      symbol: "AAPL",
      period: "day",
      startTime: "2020-01-01",
      endTime: "2020-01-10",
      source: "fixture",
    });
    expect(data.bars).toHaveLength(0);
    expect(data.qualityStatus).toBe("degraded");
    expect(data.warnings.join()).toContain("无数据");
  });

  it("缓存命中：同参数第二次不重复调用 provider", async () => {
    let calls = 0;
    const counting: FixtureProvider = new (class extends FixtureProvider {
      override async fetchCandles(input: Parameters<FixtureProvider["fetchCandles"]>[0]) {
        calls++;
        return super.fetchCandles(input);
      }
    })();
    const service = new HistoryService({ fixtureProvider: counting });
    const q = { symbol: "AAPL", period: "day" as const, startTime: "2026-08-01", endTime: "2026-08-20", source: "fixture" as const };
    const a = await service.getHistory(q);
    const b = await service.getHistory(q);
    expect(calls).toBe(1);
    expect(b.dataVersion).toBe(a.dataVersion);
  });

  it("缓存过期后重新拉取", async () => {
    let now = 1_000_000;
    let calls = 0;
    const counting = new (class extends FixtureProvider {
      override async fetchCandles(input: Parameters<FixtureProvider["fetchCandles"]>[0]) {
        calls++;
        return super.fetchCandles(input);
      }
    })();
    const service = new HistoryService({ fixtureProvider: counting, now: () => now });
    const q = { symbol: "AAPL", period: "day" as const, startTime: "2026-08-01", endTime: "2026-08-20", source: "fixture" as const };
    await service.getHistory(q);
    now += 10 * 60 * 1000; // 超过 TTL
    await service.getHistory(q);
    expect(calls).toBe(2);
  });

  it("显式 longbridge 源但无凭据时报错（不静默换源）", async () => {
    const service = new HistoryService({ fixtureProvider: new FixtureProvider() });
    await expect(
      service.getHistory({
        symbol: "AAPL",
        period: "day",
        startTime: "2026-08-01",
        endTime: "2026-08-20",
        source: "longbridge",
      })
    ).rejects.toThrow(/不可用/);
  });

  it("clearHistoryCache 清空缓存", async () => {
    let calls = 0;
    const counting = new (class extends FixtureProvider {
      override async fetchCandles(input: Parameters<FixtureProvider["fetchCandles"]>[0]) {
        calls++;
        return super.fetchCandles(input);
      }
    })();
    const service = new HistoryService({ fixtureProvider: counting });
    const q = { symbol: "AAPL", period: "day" as const, startTime: "2026-08-01", endTime: "2026-08-20", source: "fixture" as const };
    await service.getHistory(q);
    clearHistoryCache();
    await service.getHistory(q);
    expect(calls).toBe(2);
  });
});
