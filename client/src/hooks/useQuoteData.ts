import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
}

/**
 * Hook用于获取实时股票行情数据
 * @param symbols 股票代码数组
 * @param refetchInterval 刷新间隔（毫秒）
 */
export function useQuoteData(symbols: string[], refetchInterval: number = 5000) {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: apiQuotes, isLoading } = trpc.quote.getQuotes.useQuery(
    { symbols },
    { refetchInterval }
  );

  useEffect(() => {
    if (apiQuotes && apiQuotes.length > 0) {
      const transformedQuotes = apiQuotes.map((q) => ({
        symbol: q.symbol,
        price: q.lastPrice,
        change: q.change,
        changePercent: q.changePercent,
        high: q.highPrice,
        low: q.lowPrice,
        volume: q.volume,
      }));
      setQuotes(transformedQuotes);
      setLoading(false);
    }
  }, [apiQuotes]);

  return { quotes, loading: loading || isLoading, error };
}

/**
 * Hook用于获取账户资产信息
 */
export function useAccountAssets() {
  const { data: assets, isLoading, error } = trpc.quote.getAccountAssets.useQuery(
    undefined,
    { refetchInterval: 10000 }
  );

  return {
    totalAssets: assets?.totalAssets || 0,
    availableCash: assets?.availableCash || 0,
    marketValue: assets?.marketValue || 0,
    buyingPower: assets?.buyingPower || 0,
    currency: assets?.currency || "USD",
    loading: isLoading,
    error,
  };
}

/**
 * Hook用于获取K线数据
 */
export function useKlineData(
  symbol: string,
  period: "day" | "week" | "month" | "1m" | "5m" | "15m" | "30m" | "60m" = "day"
) {
  const { data: klines, isLoading, error } = trpc.quote.getKline.useQuery(
    { symbol, period, limit: 100 },
    { refetchInterval: 30000 }
  );

  return {
    klines: klines || [],
    loading: isLoading,
    error,
  };
}
