import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  submitMarketOrder,
  submitLimitOrder,
  getOrderStatus,
  cancelOrder,
  getAllOrders,
  executeAutoTrade,
} from "../services/longbridgeTrading";

export const tradingRouter = router({
  /**
   * 提交市价单
   */
  submitMarketOrder: publicProcedure
    .input(
      z.object({
        symbol: z.string(),
        quantity: z.number().positive(),
        side: z.enum(["buy", "sell"]),
      })
    )
    .mutation(async ({ input }) => {
      const order = await submitMarketOrder(input.symbol, input.quantity, input.side);
      return (
        order || {
          orderId: "",
          symbol: input.symbol,
          quantity: input.quantity,
          price: 0,
          side: input.side,
          status: "rejected" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "订单提交失败",
        }
      );
    }),

  /**
   * 提交限价单
   */
  submitLimitOrder: publicProcedure
    .input(
      z.object({
        symbol: z.string(),
        quantity: z.number().positive(),
        price: z.number().positive(),
        side: z.enum(["buy", "sell"]),
      })
    )
    .mutation(async ({ input }) => {
      const order = await submitLimitOrder(
        input.symbol,
        input.quantity,
        input.price,
        input.side
      );
      return (
        order || {
          orderId: "",
          symbol: input.symbol,
          quantity: input.quantity,
          price: input.price,
          side: input.side,
          status: "rejected" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "订单提交失败",
        }
      );
    }),

  /**
   * 查询订单状态
   */
  getOrderStatus: publicProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ input }) => {
      const order = await getOrderStatus(input.orderId);
      return (
        order || {
          orderId: input.orderId,
          symbol: "",
          quantity: 0,
          price: 0,
          side: "buy" as const,
          status: "cancelled" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "订单不存在",
        }
      );
    }),

  /**
   * 撤销订单
   */
  cancelOrder: publicProcedure
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ input }) => {
      const success = await cancelOrder(input.orderId);
      return { success, orderId: input.orderId };
    }),

  /**
   * 获取所有订单
   */
  getAllOrders: publicProcedure.query(async () => {
    const orders = await getAllOrders();
    return orders;
  }),

  /**
   * 执行自动交易
   */
  executeAutoTrade: publicProcedure
    .input(
      z.object({
        symbol: z.string(),
        action: z.enum(["buy", "sell"]),
        quantity: z.number().positive(),
        targetPrice: z.number().positive().optional(),
        useMarketOrder: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const order = await executeAutoTrade(
        input.symbol,
        input.action,
        input.quantity,
        input.targetPrice,
        input.useMarketOrder
      );
      return (
        order || {
          orderId: "",
          symbol: input.symbol,
          quantity: input.quantity,
          price: input.targetPrice || 0,
          side: input.action,
          status: "rejected" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "自动交易执行失败",
        }
      );
    }),
});
