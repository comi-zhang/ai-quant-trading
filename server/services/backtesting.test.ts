import { describe, expect, it } from "vitest";
import { runBacktest, generateBacktestReport, compareBacktestResults, type BacktestConfig } from "./backtesting";

describe("Backtesting Service", () => {
  describe("runBacktest", () => {
    it("should run backtest with buy and hold strategy", () => {
      const prices = [100, 101, 102, 103, 104, 105];
      const dates = [
        new Date("2025-01-01"),
        new Date("2025-01-02"),
        new Date("2025-01-03"),
        new Date("2025-01-04"),
        new Date("2025-01-05"),
        new Date("2025-01-06"),
      ];
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold", "sell"];

      const config: BacktestConfig = {
        symbol: "AAPL",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        initialCapital: 10000,
        stopLossPercent: 2,
        takeProfitPercent: 5,
        positionSize: 5000,
      };

      const result = runBacktest(prices, dates, config, signals);

      expect(result.symbol).toBe("AAPL");
      expect(result.initialCapital).toBe(10000);
      expect(result.totalTrades).toBeGreaterThan(0);
      expect(result.finalCapital).toBeGreaterThan(0);
      expect(result.totalReturnPercent).toBeGreaterThan(0); // Profitable trade
    });

    it("should handle stop loss correctly", () => {
      const prices = [100, 99, 98, 97, 96]; // Continuous decline
      const dates = [
        new Date("2025-01-01"),
        new Date("2025-01-02"),
        new Date("2025-01-03"),
        new Date("2025-01-04"),
        new Date("2025-01-05"),
      ];
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold"];

      const config: BacktestConfig = {
        symbol: "AAPL",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        initialCapital: 10000,
        stopLossPercent: 2, // Stop loss at 98
        takeProfitPercent: 5,
        positionSize: 5000,
      };

      const result = runBacktest(prices, dates, config, signals);

      // Should have closed position due to stop loss
      expect(result.totalTrades).toBe(1);
      expect(result.trades[0].pnl).toBeLessThan(0); // Loss
    });

    it("should handle take profit correctly", () => {
      const prices = [100, 101, 102, 103, 104, 105, 106]; // Continuous increase
      const dates = Array.from({ length: 7 }, (_, i) => new Date(`2025-01-0${i + 1}`));
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold", "hold", "hold"];

      const config: BacktestConfig = {
        symbol: "AAPL",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        initialCapital: 10000,
        stopLossPercent: 2,
        takeProfitPercent: 5, // Take profit at 105
        positionSize: 5000,
      };

      const result = runBacktest(prices, dates, config, signals);

      // Should have closed position due to take profit
      expect(result.totalTrades).toBe(1);
      expect(result.trades[0].pnl).toBeGreaterThan(0); // Profit
    });

    it("should calculate correct win rate", () => {
      const prices = [100, 102, 101, 103, 102, 104]; // Mix of wins and losses
      const dates = Array.from({ length: 6 }, (_, i) => new Date(`2025-01-0${i + 1}`));
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "sell", "buy", "sell", "buy", "sell"];

      const config: BacktestConfig = {
        symbol: "AAPL",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        initialCapital: 10000,
        stopLossPercent: 2,
        takeProfitPercent: 10,
        positionSize: 5000,
      };

      const result = runBacktest(prices, dates, config, signals);

      expect(result.winRate).toBeGreaterThanOrEqual(0);
      expect(result.winRate).toBeLessThanOrEqual(100);
      expect(result.totalTrades).toBe(3); // Three complete trades
    });

    it("should calculate sharpe ratio", () => {
      const prices = [100, 101, 102, 103, 104];
      const dates = Array.from({ length: 5 }, (_, i) => new Date(`2025-01-0${i + 1}`));
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "sell"];

      const config: BacktestConfig = {
        symbol: "AAPL",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        initialCapital: 10000,
        stopLossPercent: 2,
        takeProfitPercent: 5,
        positionSize: 5000,
      };

      const result = runBacktest(prices, dates, config, signals);

      expect(result.sharpeRatio).toBeDefined();
      expect(typeof result.sharpeRatio).toBe("number");
    });

    it("should calculate max drawdown correctly", () => {
      const prices = [100, 110, 105, 115, 100, 120]; // Peak at 110, then drops to 100
      const dates = Array.from({ length: 6 }, (_, i) => new Date(`2025-01-0${i + 1}`));
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold", "sell"];

      const config: BacktestConfig = {
        symbol: "AAPL",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        initialCapital: 10000,
        stopLossPercent: 5,
        takeProfitPercent: 20,
        positionSize: 5000,
      };

      const result = runBacktest(prices, dates, config, signals);

      expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(result.maxDrawdown).toBeLessThanOrEqual(100);
    });
  });

  describe("时间对齐与交易成本", () => {
    const dates = Array.from({ length: 6 }, (_, i) => new Date(`2025-01-0${i + 1}`));
    const baseConfig: BacktestConfig = {
      symbol: "AAPL",
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      initialCapital: 10000,
      stopLossPercent: 50,
      takeProfitPercent: 500,
      positionSize: 5000,
    };

    it("信号在次日成交（不使用同K线价格，无前视偏差）", () => {
      const prices = [100, 200, 100, 200, 100, 200];
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold", "sell"];
      const result = runBacktest(prices, dates, baseConfig, signals);
      // 买入信号 day0 → 按 day1 价格 200 成交；卖出信号 day5 → 无次日，按 day5 收盘 200 平仓
      expect(result.trades[0].entryPrice).toBe(200);
      expect(result.trades[0].exitPrice).toBe(200);
    });

    it("交易成本降低收益", () => {
      const prices = [100, 101, 102, 103, 104, 105];
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold", "sell"];
      const free = runBacktest(prices, dates, baseConfig, signals);
      const costly = runBacktest(prices, dates, { ...baseConfig, commissionPerTrade: 50, slippagePercent: 1 }, signals);
      expect(costly.totalReturn).toBeLessThan(free.totalReturn);
      expect(costly.totalCosts).toBeGreaterThan(0);
      expect(free.totalCosts).toBe(0);
    });

    it("同一 fixture 结果可重复（确定性）", () => {
      const prices = [100, 102, 101, 103, 102, 104];
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "sell", "buy", "sell", "buy", "sell"];
      const a = runBacktest(prices, dates, baseConfig, signals);
      const b = runBacktest(prices, dates, baseConfig, signals);
      expect(a).toEqual(b);
    });

    it("基准收益率为同期买入持有", () => {
      const prices = [100, 110, 120, 130, 140, 150];
      const signals: ("buy" | "sell" | "hold")[] = ["hold", "hold", "hold", "hold", "hold", "hold"];
      const result = runBacktest(prices, dates, baseConfig, signals);
      expect(result.benchmarkReturnPercent).toBeCloseTo(50, 5);
      expect(result.totalTrades).toBe(0);
    });

    it("现金不足时不开仓", () => {
      const prices = [100, 101, 102, 103, 104, 105];
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold", "sell"];
      const result = runBacktest(prices, dates, { ...baseConfig, initialCapital: 100 }, signals);
      expect(result.totalTrades).toBe(0);
      expect(result.finalCapital).toBe(100);
    });
  });

  describe("generateBacktestReport", () => {
    it("should generate readable report", () => {
      const prices = [100, 101, 102, 103, 104, 105];
      const dates = Array.from({ length: 6 }, (_, i) => new Date(`2025-01-0${i + 1}`));
      const signals: ("buy" | "sell" | "hold")[] = ["buy", "hold", "hold", "hold", "hold", "sell"];

      const config: BacktestConfig = {
        symbol: "AAPL",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        initialCapital: 10000,
        stopLossPercent: 2,
        takeProfitPercent: 5,
        positionSize: 5000,
      };

      const result = runBacktest(prices, dates, config, signals);
      const report = generateBacktestReport(result);

      expect(report).toContain("AAPL");
      expect(report).toContain("Total Return");
      expect(report).toContain("Win Rate");
      expect(report).toContain("Sharpe Ratio");
    });
  });

  describe("compareBacktestResults", () => {
    it("should identify best performing strategy", () => {
      const results = [
        {
          symbol: "AAPL",
          startDate: new Date("2025-01-01"),
          endDate: new Date("2025-01-31"),
          initialCapital: 10000,
          finalCapital: 11000,
          totalReturn: 1000,
          totalReturnPercent: 10,
          totalTrades: 5,
          winningTrades: 3,
          losingTrades: 2,
          winRate: 60,
          averageWin: 400,
          averageLoss: 200,
          profitFactor: 2.0,
          maxDrawdown: 3,
          sharpeRatio: 1.5,
          benchmarkReturnPercent: 8,
          totalCosts: 10,
          trades: [],
        },
        {
          symbol: "MSFT",
          startDate: new Date("2025-01-01"),
          endDate: new Date("2025-01-31"),
          initialCapital: 10000,
          finalCapital: 10500,
          totalReturn: 500,
          totalReturnPercent: 5,
          totalTrades: 4,
          winningTrades: 2,
          losingTrades: 2,
          winRate: 50,
          averageWin: 300,
          averageLoss: 250,
          profitFactor: 1.2,
          maxDrawdown: 5,
          sharpeRatio: 0.8,
          benchmarkReturnPercent: 4,
          totalCosts: 8,
          trades: [],
        },
      ];

      const comparison = compareBacktestResults(results);

      expect(comparison.bestReturn.symbol).toBe("AAPL");
      expect(comparison.bestWinRate.symbol).toBe("AAPL");
      expect(comparison.bestSharpeRatio.symbol).toBe("AAPL");
      expect(comparison.lowestDrawdown.symbol).toBe("AAPL");
    });
  });
});
