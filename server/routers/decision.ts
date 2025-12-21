import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { analyzeWithGemini, analyzeMultipleWithGemini, generateTradingSignal } from "../services/geminiDecisionEngine";

export const decisionRouter = router({
  /**
   * 分析单个股票并生成交易决策
   */
  analyzeStock: publicProcedure
    .input(
      z.object({
        symbol: z.string(),
        fundamentalScore: z.number().min(0).max(100),
        sentimentScore: z.number().min(0).max(100),
        technicalScore: z.number().min(0).max(100),
        currentPrice: z.number().positive(),
        targetPrice: z.number().positive(),
        newsHeadlines: z.array(z.string()).default([]),
      })
    )
    .query(async ({ input }) => {
      const decision = await analyzeWithGemini({
        symbol: input.symbol,
        fundamentalScore: input.fundamentalScore,
        sentimentScore: input.sentimentScore,
        technicalScore: input.technicalScore,
        currentPrice: input.currentPrice,
        targetPrice: input.targetPrice,
        newsHeadlines: input.newsHeadlines,
      });

      if (!decision) {
        return {
          symbol: input.symbol,
          action: "hold" as const,
          confidence: 50,
          targetPrice: input.currentPrice,
          reasoning: "分析失败，建议持有",
          scores: {
            fundamental: input.fundamentalScore,
            sentiment: input.sentimentScore,
            technical: input.technicalScore,
            composite: Math.round(
              input.fundamentalScore * 0.4 +
                input.sentimentScore * 0.4 +
                input.technicalScore * 0.2
            ),
          },
          timestamp: new Date().toISOString(),
        };
      }

      const signal = generateTradingSignal(decision);

      return {
        ...decision,
        signal: signal.signal,
        signalText: signal.action,
      };
    }),

  /**
   * 批量分析多个股票
   */
  analyzeMultiple: publicProcedure
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
            newsHeadlines: z.array(z.string()).default([]),
          })
        ),
      })
    )
    .query(async ({ input }) => {
      const decisions = await analyzeMultipleWithGemini(input.stocks);

      return decisions.map((decision) => {
        const signal = generateTradingSignal(decision);
        return {
          ...decision,
          signal: signal.signal,
          signalText: signal.action,
        };
      });
    }),
});
