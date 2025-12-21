/**
 * Backtesting Service
 * 基于历史数据的策略回测和性能分析
 */

export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  positionSize: number; // 每个持仓的金额
}

export interface BacktestTrade {
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  quantity: number;
  side: "buy" | "sell";
  pnl: number;
  pnlPercent: number;
  holdingDays: number;
}

export interface BacktestResult {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  totalReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
}

/**
 * 运行回测
 */
export function runBacktest(
  historicalPrices: number[],
  historicalDates: Date[],
  config: BacktestConfig,
  signals: ("buy" | "sell" | "hold")[]
): BacktestResult {
  if (
    historicalPrices.length !== historicalDates.length ||
    historicalPrices.length !== signals.length
  ) {
    throw new Error("Price, date, and signal arrays must have the same length");
  }

  let capital = config.initialCapital;
  const trades: BacktestTrade[] = [];
  let position: {
    entryPrice: number;
    entryDate: Date;
    quantity: number;
  } | null = null;

  // 执行回测
  for (let i = 0; i < historicalPrices.length; i++) {
    const price = historicalPrices[i];
    const date = historicalDates[i];
    const signal = signals[i];

    if (!position && signal === "buy") {
      // 开仓
      const quantity = Math.floor(config.positionSize / price);
      if (quantity > 0 && capital >= config.positionSize) {
        position = {
          entryPrice: price,
          entryDate: date,
          quantity,
        };
        capital -= config.positionSize;
      }
    } else if (position) {
      // 检查止损止盈或卖出信号
      const pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
      const shouldExit =
        signal === "sell" ||
        pnlPercent <= -config.stopLossPercent ||
        pnlPercent >= config.takeProfitPercent;

      if (shouldExit) {
        // 平仓
        const exitValue = position.quantity * price;
        const pnl = exitValue - config.positionSize;

        trades.push({
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: date,
          exitPrice: price,
          quantity: position.quantity,
          side: "buy",
          pnl,
          pnlPercent,
          holdingDays: Math.floor(
            (date.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24)
          ),
        });

        capital += exitValue;
        position = null;
      }
    }
  }

  // 如果还有未平仓的持仓，按最后价格平仓
  if (position) {
    const lastPrice = historicalPrices[historicalPrices.length - 1];
    const lastDate = historicalDates[historicalDates.length - 1];
    const exitValue = position.quantity * lastPrice;
    const pnl = exitValue - config.positionSize;
    const pnlPercent = ((lastPrice - position.entryPrice) / position.entryPrice) * 100;

    trades.push({
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      exitDate: lastDate,
      exitPrice: lastPrice,
      quantity: position.quantity,
      side: "buy",
      pnl,
      pnlPercent,
      holdingDays: Math.floor(
        (lastDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24)
      ),
    });

    capital += exitValue;
  }

  // 计算性能指标
  const finalCapital = capital;
  const totalReturn = finalCapital - config.initialCapital;
  const totalReturnPercent = (totalReturn / config.initialCapital) * 100;

  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl < 0).length;
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

  const totalWins = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(
    trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
  );

  const averageWin = winningTrades > 0 ? totalWins / winningTrades : 0;
  const averageLoss = losingTrades > 0 ? totalLosses / losingTrades : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

  // 计算最大回撤
  let maxDrawdown = 0;
  let peak = config.initialCapital;
  let currentCapital = config.initialCapital;

  for (const trade of trades) {
    currentCapital += trade.pnl;
    if (currentCapital > peak) {
      peak = currentCapital;
    }
    const drawdown = ((peak - currentCapital) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // 计算夏普比率 (简化版)
  const returns = trades.map((t) => t.pnlPercent);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 0
      ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
      : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // 年化

  return {
    symbol: config.symbol,
    startDate: config.startDate,
    endDate: config.endDate,
    initialCapital: config.initialCapital,
    finalCapital,
    totalReturn,
    totalReturnPercent,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRate,
    averageWin,
    averageLoss,
    profitFactor,
    maxDrawdown,
    sharpeRatio,
    trades,
  };
}

/**
 * 生成回测报告
 */
export function generateBacktestReport(result: BacktestResult): string {
  const report = `
=== Backtest Report ===
Symbol: ${result.symbol}
Period: ${result.startDate.toLocaleDateString()} - ${result.endDate.toLocaleDateString()}

Capital Performance:
  Initial Capital: $${result.initialCapital.toFixed(2)}
  Final Capital: $${result.finalCapital.toFixed(2)}
  Total Return: $${result.totalReturn.toFixed(2)} (${result.totalReturnPercent.toFixed(2)}%)

Trade Statistics:
  Total Trades: ${result.totalTrades}
  Winning Trades: ${result.winningTrades}
  Losing Trades: ${result.losingTrades}
  Win Rate: ${result.winRate.toFixed(2)}%

Profitability:
  Average Win: $${result.averageWin.toFixed(2)}
  Average Loss: $${result.averageLoss.toFixed(2)}
  Profit Factor: ${result.profitFactor.toFixed(2)}

Risk Metrics:
  Max Drawdown: ${result.maxDrawdown.toFixed(2)}%
  Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}

Trades:
${result.trades
  .map(
    (t) => `
  ${t.entryDate.toLocaleDateString()} - ${t.exitDate.toLocaleDateString()}
  Entry: $${t.entryPrice.toFixed(2)} | Exit: $${t.exitPrice.toFixed(2)}
  P&L: $${t.pnl.toFixed(2)} (${t.pnlPercent.toFixed(2)}%) | Holding: ${t.holdingDays} days
`
  )
  .join("")}
`;

  return report;
}

/**
 * 比较多个策略的回测结果
 */
export function compareBacktestResults(results: BacktestResult[]): {
  bestReturn: BacktestResult;
  bestWinRate: BacktestResult;
  bestSharpeRatio: BacktestResult;
  lowestDrawdown: BacktestResult;
} {
  return {
    bestReturn: results.reduce((best, current) =>
      current.totalReturnPercent > best.totalReturnPercent ? current : best
    ),
    bestWinRate: results.reduce((best, current) =>
      current.winRate > best.winRate ? current : best
    ),
    bestSharpeRatio: results.reduce((best, current) =>
      current.sharpeRatio > best.sharpeRatio ? current : best
    ),
    lowestDrawdown: results.reduce((best, current) =>
      current.maxDrawdown < best.maxDrawdown ? current : best
    ),
  };
}
