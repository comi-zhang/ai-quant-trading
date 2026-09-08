import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { AutoTradingStrategy } from "../services/autoTradingStrategy";
import { normalizeSymbol } from "../services/longbridge/contract";

/**
 * AI 决策路由（protected）
 * - 分析走真实数据链并持久化；
 * - 数据不足时 dataQuality=insufficient，绝不返回编造的分数。
 */
export const decisionRouter = router({
  /** 分析单个股票并持久化决策（只读，不下单） */
  analyzeStock: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const strategy = new AutoTradingStrategy();
      const analysis = await strategy.analyze(normalizeSymbol(input.symbol));
      const persisted = await strategy.persistDecision(ctx.user.id, analysis);
      return { ...analysis, decisionId: persisted?.id ?? null };
    }),
});
