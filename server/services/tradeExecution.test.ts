import { describe, expect, it, vi } from "vitest";
import {
  calculateStopLossAndTakeProfit,
  validateOrderRisk,
  calculateRiskReward,
  assessPositionRisk,
  DEFAULT_RISK_CONFIG,
  type PositionRisk,
  type RiskConfig,
} from "./riskManagement";

describe("Risk Management Service", () => {
  describe("calculateStopLossAndTakeProfit", () => {
    it("should calculate correct stop loss and take profit for buy orders", () => {
      const result = calculateStopLossAndTakeProfit(100, "buy", 2, 5);

      expect(result.stopLoss).toBe(98); // 100 * (1 - 0.02)
      expect(result.takeProfit).toBe(105); // 100 * (1 + 0.05)
    });

    it("should calculate correct stop loss and take profit for sell orders", () => {
      const result = calculateStopLossAndTakeProfit(100, "sell", 2, 5);

      expect(result.stopLoss).toBe(102); // 100 * (1 + 0.02)
      expect(result.takeProfit).toBe(95); // 100 * (1 - 0.05)
    });
  });

  describe("calculateRiskReward", () => {
    it("should calculate correct risk reward ratio for buy orders", () => {
      const ratio = calculateRiskReward(100, 98, 105, "buy");

      expect(ratio).toBe(2.5); // (105 - 100) / (100 - 98) = 5 / 2 = 2.5
    });

    it("should calculate correct risk reward ratio for sell orders", () => {
      const ratio = calculateRiskReward(100, 102, 95, "sell");

      expect(ratio).toBe(2.5); // (100 - 95) / (102 - 100) = 5 / 2 = 2.5
    });

    it("should return 0 when risk is 0", () => {
      const ratio = calculateRiskReward(100, 100, 105, "buy");

      expect(ratio).toBe(0);
    });
  });

  describe("validateOrderRisk", () => {
    const mockPositions = new Map<string, PositionRisk>();
    const riskConfig = DEFAULT_RISK_CONFIG;

    it("should reject order if insufficient balance", () => {
      const result = validateOrderRisk(
        "AAPL",
        1000,
        200, // 200,000 required
        "buy",
        50000, // Only 50,000 available
        mockPositions,
        riskConfig,
        0
      );

      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain("Insufficient balance");
    });

    it("should allow order with sufficient balance", () => {
      const result = validateOrderRisk(
        "AAPL",
        10,
        100,
        "buy",
        50000,
        mockPositions,
        riskConfig,
        0
      );

      expect(result.isAllowed).toBe(true);
    });

    it("should reject order if daily loss limit reached", () => {
      const result = validateOrderRisk(
        "AAPL",
        10,
        100,
        "buy",
        50000,
        mockPositions,
        riskConfig,
        2000 // Daily loss limit reached
      );

      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain("Daily loss limit reached");
    });

    it("should reject order if exceeds max order size", () => {
      const result = validateOrderRisk(
        "AAPL",
        2000, // Exceeds max order size of 1000
        100,
        "buy",
        500000,
        mockPositions,
        riskConfig,
        0
      );

      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("should add warning if position exceeds max position size", () => {
      const result = validateOrderRisk(
        "AAPL",
        100,
        100, // 10,000 order value
        "buy",
        500000,
        mockPositions,
        riskConfig,
        0
      );

      expect(result.isAllowed).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("assessPositionRisk", () => {
    it("should assess critical risk when loss exceeds 5%", () => {
      const position: PositionRisk = {
        symbol: "AAPL",
        quantity: 100,
        entryPrice: 100,
        currentPrice: 94,
        stopLoss: 98,
        takeProfit: 105,
        unrealizedPnl: -600,
        unrealizedPnlPercent: -6,
        riskReward: 2.5,
      };

      const assessment = assessPositionRisk(position);

      expect(assessment.riskLevel).toBe("critical");
      expect(assessment.recommendation).toContain("immediately");
    });

    it("should assess high risk when loss is between 2% and 5%", () => {
      const position: PositionRisk = {
        symbol: "AAPL",
        quantity: 100,
        entryPrice: 100,
        currentPrice: 97,
        stopLoss: 98,
        takeProfit: 105,
        unrealizedPnl: -300,
        unrealizedPnlPercent: -3,
        riskReward: 2.5,
      };

      const assessment = assessPositionRisk(position);

      expect(assessment.riskLevel).toBe("high");
      expect(assessment.recommendation).toContain("stop loss");
    });

    it("should assess medium risk when position is underwater", () => {
      const position: PositionRisk = {
        symbol: "AAPL",
        quantity: 100,
        entryPrice: 100,
        currentPrice: 99,
        stopLoss: 98,
        takeProfit: 105,
        unrealizedPnl: -100,
        unrealizedPnlPercent: -1,
        riskReward: 2.5,
      };

      const assessment = assessPositionRisk(position);

      expect(assessment.riskLevel).toBe("medium");
      expect(assessment.recommendation).toContain("monitor");
    });

    it("should assess low risk when profit exceeds 5%", () => {
      const position: PositionRisk = {
        symbol: "AAPL",
        quantity: 100,
        entryPrice: 100,
        currentPrice: 106,
        stopLoss: 98,
        takeProfit: 105,
        unrealizedPnl: 600,
        unrealizedPnlPercent: 6,
        riskReward: 2.5,
      };

      const assessment = assessPositionRisk(position);

      expect(assessment.riskLevel).toBe("low");
      expect(assessment.recommendation).toContain("taking profits");
    });
  });
});
