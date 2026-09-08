import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getHistoryService } from "../services/history/service";
import { historyQuerySchema } from "../services/history/types";
import { backtestInputSchema } from "../services/backtest/types";
import { BacktestRunManager } from "../services/backtest/runManager";

/**
 * 回测路由（全部 protected）
 * - 只读历史数据 + 本地策略回测；不调用任何真实交易 mutation；
 * - 长任务：run id + 状态轮询 + 取消；短任务同样走 run（统一语义）；
 * - 失败/空数据以明确状态返回，不返回伪造结果。
 */

async function requireManager(): Promise<BacktestRunManager> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库不可用，无法运行回测" });
  }
  return new BacktestRunManager({ db });
}

export const backtestRouter = router({
  /** 历史数据预览（图表/校验用） */
  previewHistory: protectedProcedure.input(historyQuerySchema).query(async ({ input }) => {
    const service = getHistoryService();
    try {
      return await service.getHistory(input);
    } catch (err) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: `历史数据获取失败: ${(err as Error).message}` });
    }
  }),

  /** 创建回测 run（幂等：同 idempotencyKey 返回已有 run） */
  createRun: protectedProcedure
    .input(z.object({ input: backtestInputSchema, idempotencyKey: z.string().min(8).max(80).optional() }))
    .mutation(async ({ ctx, input }) => {
      const manager = await requireManager();
      return manager.createRun(ctx.user.id, input.input, input.idempotencyKey);
    }),

  /** run 状态 + 进度 */
  getRun: protectedProcedure
    .input(z.object({ runId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const manager = await requireManager();
      const run = await manager.getRun(ctx.user.id, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "run 不存在" });
      return run;
    }),

  listRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const manager = await requireManager();
      return manager.listRuns(ctx.user.id, input?.limit ?? 20);
    }),

  /** 完整结果（仅 completed） */
  getResult: protectedProcedure
    .input(z.object({ runId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const manager = await requireManager();
      const result = await manager.getResult(ctx.user.id, input.runId);
      if (!result) {
        const run = await manager.getRun(ctx.user.id, input.runId);
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "run 不存在" });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `run 尚未完成（当前状态: ${run.status}）${run.error ? `，错误: ${run.error}` : ""}`,
        });
      }
      return result;
    }),

  /** 事件分页（回放/交易表） */
  getEvents: protectedProcedure
    .input(
      z.object({
        runId: z.number().int().positive(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const manager = await requireManager();
      const result = await manager.getResult(ctx.user.id, input.runId);
      if (!result) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "run 尚未完成" });
      }
      return {
        total: result.events.length,
        offset: input.offset,
        events: result.events.slice(input.offset, input.offset + input.limit),
      };
    }),

  cancelRun: protectedProcedure
    .input(z.object({ runId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const manager = await requireManager();
      const run = await manager.cancel(ctx.user.id, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "run 不存在" });
      return run;
    }),

  pauseRun: protectedProcedure
    .input(z.object({ runId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const manager = await requireManager();
      const run = await manager.pause(ctx.user.id, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "run 不存在" });
      return run;
    }),

  resumeRun: protectedProcedure
    .input(z.object({ runId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const manager = await requireManager();
      const run = await manager.resume(ctx.user.id, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "run 不存在" });
      return run;
    }),

  /** 重新运行（新 run，不覆盖旧结果） */
  rerunRun: protectedProcedure
    .input(z.object({ runId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const manager = await requireManager();
      const run = await manager.rerun(ctx.user.id, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "run 不存在" });
      return run;
    }),
});
