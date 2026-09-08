/**
 * 技术指标计算（纯函数，可测）
 * 输入为按时间升序的收盘价数组；数据不足时返回 null（不得伪造 50 分）。
 */

export function calculateSMA(prices: number[], period: number): number[] {
  if (period <= 0 || prices.length < period) return [];
  const sma: number[] = [];
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= period) sum -= prices[i - period];
    if (i >= period - 1) sma.push(sum / period);
  }
  return sma;
}

export function calculateEMA(prices: number[], period: number): number[] {
  if (period <= 0 || prices.length < period) return [];
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(prev);
  for (let i = period; i < prices.length; i++) {
    prev = (prices[i] - prev) * multiplier + prev;
    ema.push(prev);
  }
  return ema;
}

export function calculateRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function calculateMACD(
  prices: number[]
): { macd: number; signal: number; histogram: number } | null {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  if (ema12.length === 0 || ema26.length === 0) return null;
  // 对齐：ema26 从 index 25 开始
  const macdSeries: number[] = [];
  const offset = 26 - 12;
  for (let i = 0; i < ema26.length; i++) {
    macdSeries.push(ema12[i + offset] - ema26[i]);
  }
  const signalSeries = calculateEMA(macdSeries, 9);
  const macd = macdSeries[macdSeries.length - 1];
  const signal = signalSeries.length > 0 ? signalSeries[signalSeries.length - 1] : 0;
  return { macd, signal, histogram: macd - signal };
}

/**
 * 综合技术评分 (0-100)。数据不足返回 null。
 */
export function calculateTechnicalScore(prices: number[]): number | null {
  if (prices.length < 50) return null;
  const rsi = calculateRSI(prices);
  const macd = calculateMACD(prices);
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  if (rsi === null || macd === null || sma20.length === 0 || sma50.length === 0) return null;

  let score = 50;
  if (rsi < 30) score += 15;
  else if (rsi > 70) score -= 15;
  else if (rsi > 40 && rsi < 60) score += 5;

  score += macd.histogram > 0 ? 10 : -10;

  const lastPrice = prices[prices.length - 1];
  const lastSma20 = sma20[sma20.length - 1];
  const lastSma50 = sma50[sma50.length - 1];
  if (lastPrice > lastSma20 && lastSma20 > lastSma50) score += 15;
  else if (lastPrice < lastSma20 && lastSma20 < lastSma50) score -= 15;

  return Math.max(0, Math.min(100, score));
}
