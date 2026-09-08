import type { BacktestMetrics, EquityPoint, RoundTripTrade } from "./types";

/**
 * 回测指标计算（由 equityCurve + trades 导出，单一事实来源）
 */

export function computeMetrics(input: {
  initialCapital: number;
  finalEquity: number;
  equityCurve: EquityPoint[];
  trades: RoundTripTrade[];
  bars: { timestamp: string; close: number }[];
  totalCommission: number;
  totalSlippageCost: number;
  totalSpreadCost: number;
  totalTradedValue: number;
}): BacktestMetrics {
  const { initialCapital, finalEquity, equityCurve, trades, bars } = input;

  const netProfit = finalEquity - initialCapital;
  const returnPct = (netProfit / initialCapital) * 100;

  // 年化（按自然日）
  let annualizedReturnPct: number | null = null;
  if (bars.length > 1) {
    const days =
      (new Date(bars[bars.length - 1].timestamp).getTime() - new Date(bars[0].timestamp).getTime()) /
      (24 * 3600 * 1000);
    if (days > 0 && finalEquity > 0) {
      annualizedReturnPct = (Math.pow(finalEquity / initialCapital, 365 / days) - 1) * 100;
    }
  }

  // 最大回撤 + 区间
  let maxDrawdownPct = 0;
  let ddStart: string | null = null;
  let ddEnd: string | null = null;
  let peakTime: string | null = null;
  for (const p of equityCurve) {
    if (p.drawdownPct >= maxDrawdownPct) {
      if (p.drawdownPct > maxDrawdownPct) {
        ddStart = peakTime;
        ddEnd = p.timestamp;
      }
      maxDrawdownPct = p.drawdownPct;
    }
    if (p.drawdownPct === 0) {
      peakTime = p.timestamp;
    }
  }

  // Sharpe / Sortino（按 bar 收益率序列；bar 数不足返回 null）
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (equityCurve.length > 10) {
    const rets: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      if (prev > 0) rets.push(equityCurve[i].equity / prev - 1);
    }
    if (rets.length > 5) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
      const std = Math.sqrt(variance);
      if (std > 0) sharpe = (mean / std) * Math.sqrt(252);
      const downside = rets.filter((r) => r < 0);
      if (downside.length > 0) {
        const ddVar = downside.reduce((s, r) => s + r ** 2, 0) / rets.length;
        const ddStd = Math.sqrt(ddVar);
        if (ddStd > 0) sortino = (mean / ddStd) * Math.sqrt(252);
      }
    }
  }

  // 交易统计
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  let maxConsecutiveLosses = 0;
  let curStreak = 0;
  for (const t of trades) {
    if (t.pnl < 0) {
      curStreak++;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, curStreak);
    } else {
      curStreak = 0;
    }
  }

  // 换手率 = 总成交额 / 平均权益
  const avgEquity =
    equityCurve.length > 0
      ? equityCurve.reduce((s, p) => s + p.equity, 0) / equityCurve.length
      : initialCapital;
  const turnoverPct = avgEquity > 0 ? (input.totalTradedValue / avgEquity) * 100 : 0;

  // 基准：buy & hold（全部初始资金按首 bar 收盘买入，持有到最后）
  let benchmarkReturnPct = 0;
  let benchmarkFinalEquity = initialCapital;
  if (bars.length > 1 && bars[0].close > 0) {
    const qty = initialCapital / bars[0].close;
    benchmarkFinalEquity = qty * bars[bars.length - 1].close;
    benchmarkReturnPct = ((benchmarkFinalEquity - initialCapital) / initialCapital) * 100;
  }

  return {
    netProfit,
    returnPct,
    annualizedReturnPct,
    finalEquity,
    maxDrawdownPct,
    maxDrawdownInterval: ddStart && ddEnd ? { start: ddStart, end: ddEnd } : null,
    sharpe,
    sortino,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : null,
    totalTrades: trades.length,
    avgWin: wins.length > 0 ? totalWins / wins.length : null,
    avgLoss: losses.length > 0 ? totalLosses / losses.length : null,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? null : null,
    totalCommission: input.totalCommission,
    totalSlippageCost: input.totalSlippageCost,
    totalSpreadCost: input.totalSpreadCost,
    turnoverPct,
    avgHoldingBars:
      trades.length > 0 ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length : null,
    maxConsecutiveLosses,
    benchmarkReturnPct,
    benchmarkFinalEquity,
  };
}
