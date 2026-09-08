import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getOrCreateRiskConfig, setTradingHalted, updateRiskConfig } from "../services/riskService";
import { recordAudit } from "../db";

/**
 * 风控路由（全部 protected）
 * - 配置服务端持久化，保存即生效（下次下单使用同一快照语义）；
 * - kill switch 立即生效于所有新订单。
 */

const updateSchema = z
  .object({
    maxPositionSize: z.number().positive().max(100_000_000).optional(),
    maxTotalExposure: z.number().positive().max(1_000_000_000).optional(),
    maxOrderQuantity: z.number().int().positive().max(1_000_000).optional(),
    maxDailyTrades: z.number().int().positive().max(10_000).optional(),
    maxDailyLoss: z.number().positive().max(100_000_000).optional(),
    minAccountBalance: z.number().min(0).max(100_000_000).optional(),
    stopLossPercent: z.number().positive().max(100).optional(),
    takeProfitPercent: z.number().positive().max(1000).optional(),
    enableAutoTrading: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "至少提供一个字段" });

export const riskRouter = router({
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const config = await getOrCreateRiskConfig(ctx.user.id);
    if (!config) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库不可用，无法读取风险配置" });
    }
    return config;
  }),

  updateConfig: protectedProcedure.input(updateSchema).mutation(async ({ ctx, input }) => {
    const updated = await updateRiskConfig(ctx.user.id, input);
    if (!updated) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库不可用，无法保存风险配置" });
    }
    await recordAudit({
      userId: ctx.user.id,
      eventType: "risk_config.updated",
      entityType: "risk_config",
      entityId: String(updated.id),
      payload: { version: updated.version, changes: Object.keys(input) },
    });
    return updated;
  }),

  /** kill switch：暂停全部新订单 */
  haltTrading: protectedProcedure
    .input(z.object({ reason: z.string().max(200).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const updated = await setTradingHalted(ctx.user.id, true, input?.reason);
      if (!updated) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库不可用" });
      }
      await recordAudit({
        userId: ctx.user.id,
        eventType: "risk.trading_halted",
        entityType: "risk_config",
        entityId: String(updated.id),
        payload: { reason: input?.reason ?? "manual" },
      });
      return updated;
    }),

  resumeTrading: protectedProcedure.mutation(async ({ ctx }) => {
    const updated = await setTradingHalted(ctx.user.id, false);
    if (!updated) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库不可用" });
    }
    await recordAudit({
      userId: ctx.user.id,
      eventType: "risk.trading_resumed",
      entityType: "risk_config",
      entityId: String(updated.id),
    });
    return updated;
  }),
});
