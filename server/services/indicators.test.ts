import { describe, expect, it } from "vitest";
import { calculateSMA, calculateEMA, calculateRSI, calculateMACD, calculateTechnicalScore } from "./indicators";

describe("indicators", () => {
  it("SMA 计算正确", () => {
    expect(calculateSMA([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
    expect(calculateSMA([1, 2], 3)).toEqual([]);
  });

  it("EMA 首值为 SMA，后续递推", () => {
    const ema = calculateEMA([1, 2, 3, 4, 5], 3);
    expect(ema[0]).toBe(2); // SMA(1,2,3)
    expect(ema.length).toBe(3);
    expect(ema[1]).toBe(3); // (4-2)*0.5+2
    expect(ema[2]).toBe(4); // (5-3)*0.5+3
  });

  it("RSI 数据不足返回 null（不伪造 50）", () => {
    expect(calculateRSI([1, 2, 3], 14)).toBeNull();
  });

  it("RSI 全涨为 100，全跌为 0", () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(calculateRSI(up, 14)).toBe(100);
    const down = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(calculateRSI(down, 14)).toBeCloseTo(0, 5);
  });

  it("MACD 数据不足返回 null", () => {
    expect(calculateMACD([1, 2, 3])).toBeNull();
  });

  it("技术评分数据不足返回 null（绝不返回固定 50）", () => {
    expect(calculateTechnicalScore(Array.from({ length: 30 }, (_, i) => 100 + i))).toBeNull();
  });

  it("带回调的上涨趋势评分 > 50，下跌趋势 < 50", () => {
    // 上涨 + 小幅振荡回调（MACD 柱状为正、均线多头）
    const up = Array.from({ length: 60 }, (_, i) => 100 + i * 0.8 + 1.5 * Math.sin(i));
    expect(calculateTechnicalScore(up)!).toBeGreaterThan(50);
    const down = Array.from({ length: 60 }, (_, i) => 200 - i);
    expect(calculateTechnicalScore(down)!).toBeLessThan(50);
  });

  it("RSI 超买区（>70）会被扣分（均值回归启发式）", () => {
    // 直线上涨 RSI=100 → 超买扣分，验证评分规则的边界行为
    const straightUp = Array.from({ length: 60 }, (_, i) => 100 + i);
    const score = calculateTechnicalScore(straightUp)!;
    expect(score).not.toBeNull();
    expect(score).toBeLessThan(70); // 不会给出极端高分
  });
});
