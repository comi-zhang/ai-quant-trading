/**
 * Risk Management Service
 * 实现止损止盈检查、交易限额验证、账户资金检查
 */

export interface RiskConfig {
  maxLossPerTrade: number; // 单笔交易最大亏损金额
  maxLossPerDay: number; // 日最大亏损金额
  maxPositionSize: number; // 单个持仓最大金额
  maxTotalPositionSize: number; // 总持仓最大金额
  stopLossPercent: number; // 止损百分比 (e.g., 2.0 = 2%)
  takeProfitPercent: number; // 止盈百分比 (e.g., 5.0 = 5%)
  maxOrderSize: number; // 单笔订单最大数量
  minAccountBalance: number; // 账户最小保留余额
}

export interface RiskCheckResult {
  isAllowed: boolean;
  reason?: string;
  warnings: string[];
}

export interface PositionRisk {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  riskReward: number; // 风险回报比
}

/**
 * 检查是否应该执行止损
 */
export function checkStopLoss(position: PositionRisk): boolean {
  return position.currentPrice <= position.stopLoss;
}

/**
 * 检查是否应该执行止盈
 */
export function checkTakeProfit(position: PositionRisk): boolean {
  return position.currentPrice >= position.takeProfit;
}

/**
 * 计算止损和止盈价格
 */
export function calculateStopLossAndTakeProfit(
  entryPrice: number,
  side: "buy" | "sell",
  stopLossPercent: number,
  takeProfitPercent: number
): { stopLoss: number; takeProfit: number } {
  if (side === "buy") {
    return {
      stopLoss: entryPrice * (1 - stopLossPercent / 100),
      takeProfit: entryPrice * (1 + takeProfitPercent / 100),
    };
  } else {
    return {
      stopLoss: entryPrice * (1 + stopLossPercent / 100),
      takeProfit: entryPrice * (1 - takeProfitPercent / 100),
    };
  }
}

/**
 * 验证订单是否符合风险要求
 */
export function validateOrderRisk(
  symbol: string,
  quantity: number,
  price: number,
  side: "buy" | "sell",
  accountBalance: number,
  currentPositions: Map<string, PositionRisk>,
  riskConfig: RiskConfig,
  dailyLoss: number
): RiskCheckResult {
  const warnings: string[] = [];

  // 1. 检查账户余额
  const orderValue = quantity * price;
  const requiredBalance = orderValue * 1.1; // 需要额外10%的缓冲

  if (requiredBalance > accountBalance) {
    return {
      isAllowed: false,
      reason: `Insufficient balance. Required: $${requiredBalance.toFixed(2)}, Available: $${accountBalance.toFixed(2)}`,
      warnings,
    };
  }

  // 2. 检查单笔交易最大亏损
  const maxLossPerTrade = riskConfig.maxLossPerTrade;
  if (maxLossPerTrade > 0 && orderValue * 0.02 > maxLossPerTrade) {
    // 假设最大亏损为2%
    warnings.push(
      `Order size may exceed max loss per trade. Max loss: $${maxLossPerTrade.toFixed(2)}`
    );
  }

  // 3. 检查日最大亏损
  if (riskConfig.maxLossPerDay > 0 && dailyLoss >= riskConfig.maxLossPerDay) {
    return {
      isAllowed: false,
      reason: `Daily loss limit reached. Max loss: $${riskConfig.maxLossPerDay.toFixed(2)}, Current loss: $${dailyLoss.toFixed(2)}`,
      warnings,
    };
  }

  // 4. 检查单个持仓最大金额
  const currentPosition = currentPositions.get(symbol);
  const newPositionValue = currentPosition
    ? currentPosition.quantity * price + orderValue
    : orderValue;

  if (riskConfig.maxPositionSize > 0 && newPositionValue > riskConfig.maxPositionSize) {
    warnings.push(
      `Position size may exceed limit. Max: $${riskConfig.maxPositionSize.toFixed(2)}, New: $${newPositionValue.toFixed(2)}`
    );
  }

  // 5. 检查总持仓最大金额
  let totalPositionValue = 0;
  currentPositions.forEach((pos) => {
    totalPositionValue += pos.quantity * pos.currentPrice;
  });
  totalPositionValue += orderValue;

  if (
    riskConfig.maxTotalPositionSize > 0 &&
    totalPositionValue > riskConfig.maxTotalPositionSize
  ) {
    return {
      isAllowed: false,
      reason: `Total position size exceeds limit. Max: $${riskConfig.maxTotalPositionSize.toFixed(2)}, New: $${totalPositionValue.toFixed(2)}`,
      warnings,
    };
  }

  // 6. 检查单笔订单最大数量
  if (riskConfig.maxOrderSize > 0 && quantity > riskConfig.maxOrderSize) {
    return {
      isAllowed: false,
      reason: `Order quantity exceeds limit. Max: ${riskConfig.maxOrderSize}, Requested: ${quantity}`,
      warnings,
    };
  }

  // 7. 检查账户最小保留余额
  if (accountBalance - orderValue < riskConfig.minAccountBalance) {
    warnings.push(
      `Remaining balance will be below minimum. Min: $${riskConfig.minAccountBalance.toFixed(2)}, Remaining: $${(accountBalance - orderValue).toFixed(2)}`
    );
  }

  return {
    isAllowed: true,
    warnings,
  };
}

/**
 * 计算风险回报比
 */
export function calculateRiskReward(
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  side: "buy" | "sell"
): number {
  if (side === "buy") {
    const risk = entryPrice - stopLoss;
    const reward = takeProfit - entryPrice;
    return risk > 0 ? reward / risk : 0;
  } else {
    const risk = stopLoss - entryPrice;
    const reward = entryPrice - takeProfit;
    return risk > 0 ? reward / risk : 0;
  }
}

/**
 * 评估持仓风险
 */
export function assessPositionRisk(position: PositionRisk): {
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendation: string;
} {
  const pnlPercent = position.unrealizedPnlPercent;

  if (pnlPercent <= -5) {
    return {
      riskLevel: "critical",
      recommendation: "Consider closing position immediately",
    };
  } else if (pnlPercent <= -2) {
    return {
      riskLevel: "high",
      recommendation: "Position is in significant loss, consider stop loss",
    };
  } else if (pnlPercent <= 0) {
    return {
      riskLevel: "medium",
      recommendation: "Position is underwater, monitor closely",
    };
  } else if (pnlPercent >= 5) {
    return {
      riskLevel: "low",
      recommendation: "Position is profitable, consider taking profits",
    };
  } else {
    return {
      riskLevel: "low",
      recommendation: "Position is in good standing",
    };
  }
}

/**
 * 生成风险报告
 */
export function generateRiskReport(
  positions: PositionRisk[],
  accountBalance: number,
  dailyLoss: number,
  riskConfig: RiskConfig
): {
  totalRisk: number;
  totalReward: number;
  overallRiskLevel: "low" | "medium" | "high" | "critical";
  alerts: string[];
  recommendations: string[];
} {
  const alerts: string[] = [];
  const recommendations: string[] = [];
  let totalRisk = 0;
  let totalReward = 0;

  // 分析每个持仓
  positions.forEach((pos) => {
    const assessment = assessPositionRisk(pos);
    if (assessment.riskLevel === "critical" || assessment.riskLevel === "high") {
      alerts.push(`${pos.symbol}: ${assessment.recommendation}`);
    }

    // 累计风险和回报
    if (pos.unrealizedPnl < 0) {
      totalRisk += Math.abs(pos.unrealizedPnl);
    } else {
      totalReward += pos.unrealizedPnl;
    }
  });

  // 检查日亏损
  if (dailyLoss > riskConfig.maxLossPerDay * 0.8) {
    alerts.push(
      `Daily loss is approaching limit: $${dailyLoss.toFixed(2)} / $${riskConfig.maxLossPerDay.toFixed(2)}`
    );
  }

  // 检查账户余额
  if (accountBalance < riskConfig.minAccountBalance * 1.5) {
    alerts.push(`Account balance is low: $${accountBalance.toFixed(2)}`);
  }

  // 确定整体风险级别
  let overallRiskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (totalRisk > accountBalance * 0.1) {
    overallRiskLevel = "critical";
    recommendations.push("Reduce position sizes immediately");
  } else if (totalRisk > accountBalance * 0.05) {
    overallRiskLevel = "high";
    recommendations.push("Consider reducing some positions");
  } else if (totalRisk > accountBalance * 0.02) {
    overallRiskLevel = "medium";
    recommendations.push("Monitor positions closely");
  }

  // 风险回报建议
  if (totalReward > 0 && totalRisk > 0) {
    const riskRewardRatio = totalReward / totalRisk;
    if (riskRewardRatio < 1) {
      recommendations.push("Risk-reward ratio is unfavorable, consider adjusting positions");
    } else if (riskRewardRatio > 3) {
      recommendations.push("Excellent risk-reward ratio, consider increasing position sizes");
    }
  }

  return {
    totalRisk,
    totalReward,
    overallRiskLevel,
    alerts,
    recommendations,
  };
}

/**
 * 默认风险配置
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxLossPerTrade: 500, // $500 per trade
  maxLossPerDay: 2000, // $2000 per day
  maxPositionSize: 10000, // $10,000 per position
  maxTotalPositionSize: 50000, // $50,000 total
  stopLossPercent: 2.0, // 2% stop loss
  takeProfitPercent: 5.0, // 5% take profit
  maxOrderSize: 1000, // 1000 shares per order
  minAccountBalance: 5000, // Keep $5000 minimum
};
