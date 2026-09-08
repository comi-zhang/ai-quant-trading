import { trpc } from "@/lib/trpc";

export interface StockQuote {
  symbol: string;
  /** null = 上游未提供（UI 必须显示为未知，不得显示 0 冒充） */
  price: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

function withChange(q: {
  symbol: string;
  lastDone: number | null;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}): StockQuote {
  const change =
    q.lastDone !== null && q.prevClose !== null ? q.lastDone - q.prevClose : null;
  const changePercent =
    change !== null && q.prevClose !== null && q.prevClose > 0
      ? (change / q.prevClose) * 100
      : null;
  return {
    symbol: q.symbol,
    price: q.lastDone,
    change,
    changePercent,
    high: q.high,
    low: q.low,
    volume: q.volume,
  };
}

/**
 * 实时行情（public）。错误/加载/空状态全部显式暴露给调用方。
 */
export function useQuoteData(symbols: string[], refetchInterval: number = 15000) {
  const query = trpc.quote.getQuotes.useQuery(
    { symbols },
    { refetchInterval, retry: 1 }
  );

  return {
    quotes: (query.data ?? []).map(withChange),
    loading: query.isLoading,
    error: query.error,
    isStale: query.isStale,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}

/**
 * 账户资产总览（protected）
 */
export function useAccountAssets(refetchInterval: number = 15000) {
  const query = trpc.quote.getAccountAssets.useQuery(undefined, {
    refetchInterval,
    retry: 1,
  });

  return {
    assets: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    dataUpdatedAt: query.dataUpdatedAt,
  };
}

/**
 * K线数据
 */
export function useKlineData(symbol: string, period: "day" | "week" | "month" = "day") {
  const query = trpc.quote.getKline.useQuery(
    { symbol, period, limit: 100 },
    { refetchInterval: 60000, retry: 1 }
  );

  return {
    klines: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
  };
}
