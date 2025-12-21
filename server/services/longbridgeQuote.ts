import axios from "axios";

/**
 * Longbridge Quote Service
 * 获取实时行情数据和历史K线数据
 */

interface QuoteData {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  turnover: number;
  timestamp: string;
}

interface KlineData {
  timestamp: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

const LONGBRIDGE_API_URL = "https://openapi.longportapp.com";
const LONGBRIDGE_API_CN_URL = "https://openapi.longportapp.cn"; // For mainland China

/**
 * 获取股票实时报价
 */
export async function getQuote(symbol: string, accessToken: string): Promise<QuoteData | null> {
  try {
    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/quote`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      params: {
        symbol,
        include_ask_bid: true,
      },
    });

    const data = response.data;
    return {
      symbol,
      lastPrice: data.last_done || 0,
      openPrice: data.open || 0,
      highPrice: data.high || 0,
      lowPrice: data.low || 0,
      volume: data.volume || 0,
      turnover: data.turnover || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Longbridge] Failed to get quote for ${symbol}:`, error);
    return null;
  }
}

/**
 * 获取K线数据
 */
export async function getKline(
  symbol: string,
  period: "day" | "week" | "month" | "1m" | "5m" | "15m" | "30m" | "60m",
  accessToken: string,
  limit: number = 100
): Promise<KlineData[]> {
  try {
    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/kline`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      params: {
        symbol,
        period,
        limit,
      },
    });

    const klines = response.data || [];
    return klines.map((k: any) => ({
      timestamp: new Date(k.timestamp * 1000).toISOString(),
      open: k.open,
      close: k.close,
      high: k.high,
      low: k.low,
      volume: k.volume,
    }));
  } catch (error) {
    console.error(`[Longbridge] Failed to get kline for ${symbol}:`, error);
    return [];
  }
}

/**
 * 计算技术指标 - 简单移动平均线 (SMA)
 */
export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

/**
 * 计算技术指标 - 相对强弱指数 (RSI)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50; // Default neutral

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[prices.length - i] - prices[prices.length - i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

/**
 * 计算技术指标 - MACD
 */
export function calculateMACD(
  prices: number[]
): { macd: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  const lastEma12 = ema12[ema12.length - 1];
  const lastEma26 = ema26[ema26.length - 1];

  const macd = lastEma12 - lastEma26;
  const signal = macd; // Simplified, should use EMA of MACD
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

/**
 * 计算指数移动平均线 (EMA)
 */
function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);

  // Calculate subsequent EMAs
  for (let i = period; i < prices.length; i++) {
    const prevEma = ema[ema.length - 1];
    const newEma = (prices[i] - prevEma) * multiplier + prevEma;
    ema.push(newEma);
  }

  return ema;
}

/**
 * 综合技术指标评分 (0-100)
 * 基于RSI、MACD、SMA
 */
export function calculateTechnicalScore(prices: number[]): number {
  if (prices.length < 26) return 50; // Not enough data

  const rsi = calculateRSI(prices);
  const { histogram } = calculateMACD(prices);
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);

  let score = 50; // Base score

  // RSI scoring: 30-70 is neutral, <30 oversold (bullish), >70 overbought (bearish)
  if (rsi < 30) {
    score += 15; // Oversold, bullish signal
  } else if (rsi > 70) {
    score -= 15; // Overbought, bearish signal
  } else if (rsi > 40 && rsi < 60) {
    score += 5; // Neutral with slight bullish bias
  }

  // MACD scoring
  if (histogram > 0) {
    score += 10; // Positive histogram, bullish
  } else {
    score -= 10; // Negative histogram, bearish
  }

  // SMA scoring: price above both SMAs is bullish
  const lastPrice = prices[prices.length - 1];
  const lastSma20 = sma20[sma20.length - 1];
  const lastSma50 = sma50[sma50.length - 1];

  if (lastPrice > lastSma20 && lastSma20 > lastSma50) {
    score += 15; // Strong uptrend
  } else if (lastPrice < lastSma20 && lastSma20 < lastSma50) {
    score -= 15; // Strong downtrend
  }

  // Clamp score between 0 and 100
  return Math.max(0, Math.min(100, score));
}
