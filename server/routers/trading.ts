import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getOrderService, type OrderResult } from "../services/orderService";
import { isLiveMode } from "../services/tradingMode";

/**
 * 交易路由（全部 protected）
 * - 失败以 TRPCError 或显式 status 返回，绝不把失败伪装成 success；
 * - 默认 paper 模式；live 需要双开关，由 orderService 内部守卫。
 */

async function requireService() {
  const service = await getOrderService();
  if (!service) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "交易服务不可用（数据库未连接）。没有持久化就没有交易。",
    });
  }
  return service;
}

const submitSchema = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["buy", "sell"]),
  orderType: z.enum(["market", "limit"]),
  quantity: z.number().int().positive().max(1_000_000),
  limitPrice: z.number().positive().max(10_000_000).optional(),
  timeInForce: z.enum(["day", "gtc"]).default("day"),
  clientOrderId: z.string().min(8).max(64).optional(),
});

export const tradingRouter = router({
  /** 提交订单（市价/限价统一入口）。返回明确的业务状态，失败不是 success。 */
  submitOrder: protectedProcedure.input(submitSchema).mutation(async ({ ctx, input }) => {
    const service = await requireService();
    const result: OrderResult = await service.submitOrder({
      userId: ctx.user.id,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      quantity: input.quantity,
      limitPrice: input.limitPrice,
      timeInForce: input.timeInForce,
      clientOrderId: input.clientOrderId,
    });
    return result;
  }),

  /** 撤销订单（按本地订单 ID，账户隔离） */
  cancelOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const service = await requireService();
      const result = await service.cancelOrder({ userId: ctx.user.id, orderId: input.orderId });
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      return result;
    }),

  /** 订单列表（本地持久化记录，含状态机状态） */
  listOrders: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const service = await requireService();
      return service.listOrders(ctx.user.id, input?.limit ?? 100);
    }),

  /** 对账开放订单（手动触发；调度器也会周期执行） */
  reconcileOrders: protectedProcedure.mutation(async ({ ctx }) => {
    const service = await requireService();
    return service.reconcileOpenOrders(ctx.user.id);
  }),

  /** 成交历史 */
  listTrades: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const service = await requireService();
      return service.listTrades(ctx.user.id, input?.limit ?? 100);
    }),

  /** 当前交易模式（前端展示 paper/live 标识） */
  getTradingMode: protectedProcedure.query(() => ({
    mode: isLiveMode() ? ("live" as const) : ("paper" as const),
  })),
});
