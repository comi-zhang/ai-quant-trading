import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
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
   * 提交市价单 - 需要认证
   */
  submitMarketOrder: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(10), // 股票代码长度限制
        quantity: z.number().positive().int().max(1000000), // 数量限制
        side: z.enum(["buy", "sell"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
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
      } catch (error) {
        console.error("提交市价单失败:", error);
        return {
          orderId: "",
          symbol: input.symbol,
          quantity: input.quantity,
          price: 0,
          side: input.side,
          status: "rejected" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "订单提交失败: " + (error instanceof Error ? error.message : "未知错误"),
        };
      }
    }),

  /**
   * 提交限价单 - 需要认证
   */
  submitLimitOrder: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(10),
        quantity: z.number().positive().int().max(1000000),
        price: z.number().positive().max(1000000),
        side: z.enum(["buy", "sell"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
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
      } catch (error) {
        console.error("提交限价单失败:", error);
        return {
          orderId: "",
          symbol: input.symbol,
          quantity: input.quantity,
          price: input.price,
          side: input.side,
          status: "rejected" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "订单提交失败: " + (error instanceof Error ? error.message : "未知错误"),
        };
      }
    }),

  /**
   * 查询订单状态 - 需要认证
   */
  getOrderStatus: protectedProcedure
    .input(z.object({ orderId: z.string().min(1).max(50) }))
    .query(async ({ input }) => {
      try {
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
      } catch (error) {
        console.error("查询订单状态失败:", error);
        return {
          orderId: input.orderId,
          symbol: "",
          quantity: 0,
          price: 0,
          side: "buy" as const,
          status: "cancelled" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "查询失败",
        };
      }
    }),

  /**
   * 撤销订单 - 需要认证
   */
  cancelOrder: protectedProcedure
    .input(z.object({ orderId: z.string().min(1).max(50) }))
    .mutation(async ({ input }) => {
      try {
        const success = await cancelOrder(input.orderId);
        return { success, orderId: input.orderId };
      } catch (error) {
        console.error("[Trading] Failed to cancel order:", error);
        return { success: false, orderId: input.orderId, error: "撤销失败" };
      }
    }),

  /**
   * 获取所有订单 - 需要认证
   */
  getAllOrders: protectedProcedure.query(async () => {
    try {
      const orders = await getAllOrders();
      return orders;
    } catch (error) {
      console.error("[Trading] Failed to get orders:", error);
      return [];
    }
  }),

  /**
   * 执行自动交易 - 需要认证
   */
  executeAutoTrade: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(10),
        action: z.enum(["buy", "sell"]),
        quantity: z.number().positive().int().max(1000000),
        targetPrice: z.number().positive().max(1000000).optional(),
        useMarketOrder: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
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
      } catch (error) {
        console.error("自动交易失败:", error);
        return {
          orderId: "",
          symbol: input.symbol,
          quantity: input.quantity,
          price: input.targetPrice || 0,
          side: input.action,
          status: "rejected" as const,
          filledQuantity: 0,
          filledPrice: 0,
          timestamp: new Date().toISOString(),
          message: "自动交易执行失败: " + (error instanceof Error ? error.message : "未知错误"),
        };
      }
    }),
});
