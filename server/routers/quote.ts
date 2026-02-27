import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getRealTimeQuote, getRealTimeQuotes, getKlineData, getAccountAssets, getAccountPositions } from "../services/longbridgeRealtime";

// 股票代码白名单验证
const ALLOWED_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "NVDA", "AMD", "INTC", "NFLX"] as const;

const isAllowedSymbol = (symbol: string) => 
  ALLOWED_SYMBOLS.includes(symbol.toUpperCase() as typeof ALLOWED_SYMBOLS[number]);

const symbolSchema = z.string().min(1).max(10).refine(isAllowedSymbol, {
  message: "股票代码不在白名单中",
});

export const quoteRouter = router({
  /**
   * 获取单个股票的实时报价
   */
  getQuote: publicProcedure
    .input(z.object({ symbol: symbolSchema }))
    .query(async ({ input }) => {
      const quote = await getRealTimeQuote(input.symbol.toUpperCase());
      return quote || {
        symbol: input.symbol,
        lastPrice: 0,
        openPrice: 0,
        highPrice: 0,
        lowPrice: 0,
        volume: 0,
        timestamp: Date.now(),
        change: 0,
        changePercent: 0,
      };
    }),

  /**
   * 批量获取多个股票的实时报价
   */
  getQuotes: publicProcedure
    .input(z.object({ symbols: z.array(symbolSchema).max(20) }))
    .query(async ({ input }) => {
      const quotes = await getRealTimeQuotes(input.symbols.map(s => s.toUpperCase()));
      return quotes;
    }),

  /**
   * 获取K线数据
   */
  getKline: publicProcedure
    .input(
      z.object({
        symbol: symbolSchema,
        period: z.enum(["day", "week", "month", "1m", "5m", "15m", "30m", "60m"]).default("day"),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const klines = await getKlineData(input.symbol.toUpperCase(), input.period, input.limit);
      return klines;
    }),

  /**
   * 获取账户资产信息 - 需要认证
   */
  getAccountAssets: publicProcedure.query(async () => {
    const assets = await getAccountAssets();
    return assets || {
      totalAssets: 0,
      availableCash: 0,
      marketValue: 0,
      buyingPower: 0,
      currency: "USD",
    };
  }),

  /**
   * 获取账户持仓信息 - 需要认证
   */
  getAccountPositions: publicProcedure.query(async () => {
    const positions = await getAccountPositions();
    return positions || [];
  }),
});
