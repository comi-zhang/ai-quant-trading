import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDefaultGateway } from "../services/longbridge/gateway";
import { GatewayError } from "../services/longbridge/client";
import { normalizeSymbol } from "../services/longbridge/contract";
import { getOrderService } from "../services/orderService";

/**
 * 行情路由
 * - 行情数据 public（无账户信息），但未配置凭据/上游失败时返回明确错误，绝不返回伪造的 0 值行情；
 * - 账户资产/持仓 protected，来自本地账本（paper）或券商快照（live）。
 */

const symbolSchema = z.string().min(1).max(20).transform((s, ctx) => {
  try {
    return normalizeSymbol(s);
  } catch {
    ctx.addIssue({ code: "custom", message: "非法股票代码" });
    return z.NEVER;
  }
});

function toTrpcError(err: unknown): TRPCError {
  if (err instanceof GatewayError) {
    const code =
      err.kind === "AUTH" ? "PRECONDITION_FAILED"
      : err.kind === "RATE_LIMIT" ? "TOO_MANY_REQUESTS"
      : err.kind === "UPSTREAM" || err.kind === "NETWORK" ? "BAD_GATEWAY"
      : "INTERNAL_SERVER_ERROR";
    return new TRPCError({ code, message: err.message });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Error).message });
}

export const quoteRouter = router({
  getQuote: publicProcedure
    .input(z.object({ symbol: symbolSchema }))
    .query(async ({ input }) => {
      const gateway = getDefaultGateway();
      if (!gateway.configured) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "行情服务未配置（缺少 Longbridge 凭据）" });
      }
      try {
        return await gateway.getQuote(input.symbol);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  getQuotes: publicProcedure
    .input(z.object({ symbols: z.array(symbolSchema).min(1).max(20) }))
    .query(async ({ input }) => {
      const gateway = getDefaultGateway();
      if (!gateway.configured) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "行情服务未配置（缺少 Longbridge 凭据）" });
      }
      try {
        return await gateway.getQuotes(input.symbols);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  getKline: publicProcedure
    .input(
      z.object({
        symbol: symbolSchema,
        period: z.enum(["day", "week", "month"]).default("day"),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const gateway = getDefaultGateway();
      if (!gateway.configured) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "行情服务未配置（缺少 Longbridge 凭据）" });
      }
      try {
        return await gateway.getCandlesticks(input.symbol, input.period, input.limit);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /** 账户资产总览（paper=本地账本，live=券商快照；需要登录） */
  getAccountAssets: protectedProcedure.query(async ({ ctx }) => {
    const service = await getOrderService();
    if (!service) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库不可用，无法获取账户资产" });
    }
    return service.getAccountOverview(ctx.user.id);
  }),

  /** 当前持仓（需要登录） */
  getAccountPositions: protectedProcedure.query(async ({ ctx }) => {
    const service = await getOrderService();
    if (!service) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "数据库不可用，无法获取持仓" });
    }
    return service.listPositions(ctx.user.id);
  }),
});
