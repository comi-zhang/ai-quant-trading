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
  /** 单笔固定佣金（开/平仓各收一次），默认 0 */
  commissionPerTrade?: number;
  /** 滑点百分比（对成交不利方向调整），默认 0 */
  slippagePercent?: number;
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
  /** 基准：同期买入持有收益率（%），用于对比策略是否有超额 */
  benchmarkReturnPercent: number;
  /** 总交易成本（佣金+滑点估算） */
  totalCosts: number;
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

  const commission = config.commissionPerTrade ?? 0;
  const slippage = (config.slippagePercent ?? 0) / 100;

  // 成交价 = 信号次日价格 + 对不利方向的滑点（消除同K线前视偏差）
  const execPrice = (i: number, side: "buy" | "sell"): { price: number; index: number } => {
    const j = Math.min(i + 1, historicalPrices.length - 1);
    const raw = historicalPrices[j];
    return { price: side === "buy" ? raw * (1 + slippage) : raw * (1 - slippage), index: j };
  };

  let capital = config.initialCapital;
  let totalCosts = 0;
  const trades: BacktestTrade[] = [];
  let position: {
    entryPrice: number;
    entryDate: Date;
    quantity: number;
    entryCost: number; // 实际投入（含佣金）
  } | null = null;

  // 执行回测（最后一根K线不产生新开仓——无次日价格）
  for (let i = 0; i < historicalPrices.length; i++) {
    const price = historicalPrices[i];
    const date = historicalDates[i];
    const signal = signals[i];

    if (!position && signal === "buy" && i < historicalPrices.length - 1) {
      const exec = execPrice(i, "buy");
      const quantity = Math.floor(config.positionSize / exec.price);
      const cost = quantity * exec.price + commission;
      if (quantity > 0 && capital >= cost) {
        position = {
          entryPrice: exec.price,
          entryDate: historicalDates[exec.index],
          quantity,
          entryCost: cost,
        };
        capital -= cost;
        totalCosts += commission + quantity * exec.price * slippage;
      }
    } else if (position) {
      // 检查止损止盈或卖出信号（按当前价评估，按次日价成交）
      const pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
      const shouldExit =
        signal === "sell" ||
        pnlPercent <= -config.stopLossPercent ||
        pnlPercent >= config.takeProfitPercent;

      if (shouldExit) {
        const exec = execPrice(i, "sell");
        const exitValue = position.quantity * exec.price - commission;
        const pnl = exitValue - position.entryCost;
        const realPnlPercent = (pnl / position.entryCost) * 100;

        trades.push({
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: historicalDates[exec.index],
          exitPrice: exec.price,
          quantity: position.quantity,
          side: "buy",
          pnl,
          pnlPercent: realPnlPercent,
          holdingDays: Math.floor(
            (historicalDates[exec.index].getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24)
          ),
        });

        capital += exitValue;
        totalCosts += commission + position.quantity * exec.price * slippage;
        position = null;
      }
    }
  }

  // 如果还有未平仓的持仓，按最后价格平仓
  if (position) {
    const lastPrice = historicalPrices[historicalPrices.length - 1] * (1 - slippage);
    const lastDate = historicalDates[historicalDates.length - 1];
    const exitValue = position.quantity * lastPrice - commission;
    const pnl = exitValue - position.entryCost;
    const realPnlPercent = (pnl / position.entryCost) * 100;

    trades.push({
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      exitDate: lastDate,
      exitPrice: lastPrice,
      quantity: position.quantity,
      side: "buy",
      pnl,
      pnlPercent: realPnlPercent,
      holdingDays: Math.floor(
        (lastDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24)
      ),
    });

    capital += exitValue;
    totalCosts += commission + position.quantity * lastPrice * slippage;
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

  const benchmarkReturnPercent =
    historicalPrices.length > 1
      ? ((historicalPrices[historicalPrices.length - 1] - historicalPrices[0]) / historicalPrices[0]) * 100
      : 0;

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
    benchmarkReturnPercent,
    totalCosts,
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
