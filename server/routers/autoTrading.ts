import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { AutoTradingStrategy, getRecentDecisions } from "../services/autoTradingStrategy";
import { isAutoTradingEnabled, isLiveMode } from "../services/tradingMode";
import { autoTradingScheduler } from "../jobs/autoTradingJob";
import { recordAudit } from "../db";

/**
 * 自动交易路由（protected）
 * - dryRun：只读分析 + 持久化，绝不下单；
 * - executeNow：需要 AUTO_TRADING_ENABLED=true 且风险配置 enableAutoTrading=true，
 *   paper 模式下经完整风控/幂等/审计执行；live 仍需双开关；
 * - 调度器状态只读可见；start/stop 需要自动交易开关并写审计。
 */
export const autoTradingRouter = router({
  /** 只读分析（dry-run，推荐默认） */
  dryRun: protectedProcedure
    .input(z.object({ symbols: z.array(z.string().min(1).max(20)).min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const strategy = new AutoTradingStrategy();
      const results = [];
      for (const symbol of input.symbols) {
        results.push(await strategy.runForSymbol(ctx.user.id, symbol, { execute: false }));
      }
      return results;
    }),

  /** 立即执行一轮（受全部闸门约束） */
  executeNow: protectedProcedure
    .input(z.object({ symbols: z.array(z.string().min(1).max(20)).min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      if (!isAutoTradingEnabled()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "自动交易未启用（AUTO_TRADING_ENABLED=false）",
        });
      }
      const strategy = new AutoTradingStrategy();
      const results = [];
      for (const symbol of input.symbols) {
        results.push(await strategy.runForSymbol(ctx.user.id, symbol, { execute: true }));
      }
      await recordAudit({
        userId: ctx.user.id,
        eventType: "auto_trading.manual_run",
        payload: {
          symbols: input.symbols,
          executed: results.filter((r) => r.executed).length,
          mode: isLiveMode() ? "live" : "paper",
        },
      });
      return results;
    }),

  /** AI 决策历史（来自数据库） */
  getDecisionHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(10), symbol: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return getRecentDecisions(ctx.user.id, input.limit, input.symbol);
    }),

  /** 调度器状态 */
  getSchedulerStatus: protectedProcedure.query(() => ({
    running: autoTradingScheduler.isRunning,
    autoTradingEnabled: isAutoTradingEnabled(),
    mode: isLiveMode() ? ("live" as const) : ("paper" as const),
  })),

  /** 手动触发一轮调度 job（受租约/互斥保护） */
  runSchedulerOnce: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isAutoTradingEnabled()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "自动交易未启用（AUTO_TRADING_ENABLED=false）",
      });
    }
    const results = await autoTradingScheduler.runOnce(ctx.user.id);
    return { ran: results !== null, results };
  }),
});
