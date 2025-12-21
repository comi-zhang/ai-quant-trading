import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { executeAutoTradeForStock, executeAutoTradeForMultipleStocks } from "../services/autoTradingStrategy";

export const autoTradingRouter = router({
  /**
   * 执行单个股票的自动交易
   */
  executeSingleStock: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        fundamentalScore: z.number().min(0).max(100),
        sentimentScore: z.number().min(0).max(100),
        technicalScore: z.number().min(0).max(100),
        currentPrice: z.number().positive(),
        targetPrice: z.number().positive(),
        newsHeadlines: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await executeAutoTradeForStock(
        input.symbol,
        input.fundamentalScore,
        input.sentimentScore,
        input.technicalScore,
        input.currentPrice,
        input.targetPrice,
        input.newsHeadlines
      );

      return result;
    }),

  /**
   * 执行多个股票的自动交易
   */
  executeMultipleStocks: protectedProcedure
    .input(
      z.object({
        stocks: z.array(
          z.object({
            symbol: z.string(),
            fundamentalScore: z.number().min(0).max(100),
            sentimentScore: z.number().min(0).max(100),
            technicalScore: z.number().min(0).max(100),
            currentPrice: z.number().positive(),
            targetPrice: z.number().positive(),
            newsHeadlines: z.array(z.string()).optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const results = await executeAutoTradeForMultipleStocks(input.stocks);
      return results;
    }),

  /**
   * 获取AI决策历史
   */
  getDecisionHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(10),
        symbol: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // 这里应该从数据库查询AI决策历史
      // 目前返回空数组作为占位符
      return [];
    }),

  /**
   * 获取交易执行统计
   */
  getTradeStatistics: protectedProcedure.query(async () => {
    // 这里应该从数据库计算交易统计
    // 包括成功率、平均收益率、最大回撤等
    return {
      totalTrades: 0,
      successfulTrades: 0,
      successRate: 0,
      totalProfit: 0,
      averageReturn: 0,
      maxDrawdown: 0,
      winRate: 0,
      lossRate: 0,
    };
  }),
});
