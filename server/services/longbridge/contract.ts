import { z } from "zod";

/**
 * Longbridge OpenAPI 内部契约
 * ==========================
 * 依据（只使用官方来源）：
 * - 官方 Rust SDK `longport` 4.3.7 / `longport-httpcli` 4.3.7 源码（crates.io），
 *   其中包含全部 REST 路径、请求/响应结构与签名实现；
 * - 官方文档 https://open.longportapp.com/en/docs （与 SDK 中的 Reference 链接一一对应）。
 *
 * 关键事实：
 * - Base URL: https://openapi.longportapp.com （境外）/ .cn （境内）
 * - 鉴权头: Authorization(=access token, 无 Bearer 前缀), X-Api-Key(app key),
 *   X-Timestamp(unix 秒), X-Api-Signature, Content-Type: application/json; charset=utf-8
 * - 签名: 见 client.ts（HMAC-SHA256，与官方 SDK longport-httpcli/src/signature.rs 一致）
 * - Envelope: { code: number, message: string, data?: T }；code===0 成功；
 *   错误时响应头含 x-trace-id。
 * - 429 由官方 SDK 负责指数退避重试；本实现一致。
 */

// ---------- 通用 ----------
const decimalString = z.union([z.string(), z.number()]);

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------- Symbol 规范化（边界处统一） ----------
/** 内部规范形：AAPL.US / 700.HK。裸代码默认 .US */
export function normalizeSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (!s) throw new Error("symbol is empty");
  if (!/^[0-9A-Z-]+(\.(US|HK|SH|SZ|SG))?$/.test(s)) {
    throw new Error(`invalid symbol: ${symbol}`);
  }
  return s.includes(".") ? s : `${s}.US`;
}

export function symbolMarket(symbol: string): string {
  const n = normalizeSymbol(symbol);
  return n.split(".")[1] ?? "US";
}

// ---------- 行情 ----------
export const quoteSchema = z.object({
  symbol: z.string(),
  last_done: decimalString,
  prev_close: decimalString,
  open: decimalString,
  high: decimalString,
  low: decimalString,
  volume: decimalString,
  turnover: decimalString,
  timestamp: z.union([z.string(), z.number()]).optional(),
  trade_status: z.union([z.string(), z.number()]).optional(),
});
export type RawQuote = z.infer<typeof quoteSchema>;

export const multiQuoteResponseSchema = z.object({
  list: z.array(quoteSchema).default([]),
});

export const candlestickSchema = z.object({
  close: decimalString,
  open: decimalString,
  high: decimalString,
  low: decimalString,
  volume: decimalString,
  turnover: decimalString,
  timestamp: z.union([z.string(), z.number()]),
});
export const candlesticksResponseSchema = z.object({
  candlesticks: z.array(candlestickSchema).default([]),
});
export type RawCandlestick = z.infer<typeof candlestickSchema>;

// ---------- 资产 ----------
export const cashInfoSchema = z.object({
  currency: z.string(),
  available_cash: decimalString,
  withdrawn_cash: decimalString.optional(),
  net_cash_balance: decimalString.optional(),
});

export const accountBalanceSchema = z.object({
  total_cash: decimalString,
  max_finance_amount: decimalString.optional(),
  remaining_finance_amount: decimalString.optional(),
  risk_level: z.union([z.number(), z.string()]).optional(),
  margin_call: decimalString.optional(),
  currency: z.string(),
  cash_infos: z.array(cashInfoSchema).default([]),
  net_assets: decimalString,
  init_margin: decimalString.optional(),
  maintenance_margin: decimalString.optional(),
  buy_power: decimalString,
  frozen_transaction_fees: z.array(z.unknown()).optional(),
});
export const accountBalanceResponseSchema = z.object({
  list: z.array(accountBalanceSchema).default([]),
});
export type RawAccountBalance = z.infer<typeof accountBalanceSchema>;

export const stockPositionSchema = z.object({
  symbol: z.string(),
  symbol_name: z.string().optional(),
  quantity: decimalString,
  available_quantity: decimalString,
  currency: z.string().optional(),
  cost_price: decimalString,
  market: z.string().optional(),
});
export const stockChannelSchema = z.object({
  account_channel: z.string().optional(),
  stock_positions: z.array(stockPositionSchema).default([]),
});
export const stockPositionsResponseSchema = z.object({
  list: z.array(stockChannelSchema).default([]),
});
export type RawStockPosition = z.infer<typeof stockPositionSchema>;

// ---------- 交易 ----------
export const orderSideValues = ["Buy", "Sell"] as const;
export type BrokerOrderSide = (typeof orderSideValues)[number];

/** 官方订单状态字符串（longport/src/trade/types.rs OrderStatus） */
export const brokerOrderStatusValues = [
  "Unknown",
  "NotReported",
  "ReplacedNotReported",
  "ProtectedNotReported",
  "VarietiesNotReported",
  "FilledStatus",
  "WaitToNew",
  "NewStatus",
  "WaitToReplace",
  "PendingReplaceStatus",
  "ReplacedStatus",
  "PartialFilledStatus",
  "WaitToCancel",
  "PendingCancelStatus",
  "RejectedStatus",
  "CanceledStatus",
  "ExpiredStatus",
  "PartialWithdrawal",
] as const;
export type BrokerOrderStatus = (typeof brokerOrderStatusValues)[number];

export const submitOrderResponseSchema = z.object({
  order_id: z.string(),
});

export const brokerOrderSchema = z.object({
  order_id: z.string(),
  status: z.string(),
  stock_name: z.string().optional(),
  quantity: decimalString,
  executed_quantity: decimalString,
  submitted_quantity: decimalString.optional(),
  executed_price: decimalString.optional(),
  submitted_price: decimalString.optional(),
  order_type: z.string(),
  side: z.string(),
  symbol: z.string(),
  msg: z.string().optional(),
  submitted_at: z.union([z.string(), z.number()]).optional(),
  updated_at: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
});
export type RawBrokerOrder = z.infer<typeof brokerOrderSchema>;

export const orderListResponseSchema = z.object({
  orders: z.array(brokerOrderSchema).default([]),
  has_more: z.boolean().optional(),
});

export const executionSchema = z.object({
  order_id: z.string(),
  trade_id: z.string(),
  symbol: z.string(),
  trade_done_at: z.union([z.string(), z.number()]),
  quantity: decimalString,
  price: decimalString,
});
export const executionsResponseSchema = z.object({
  trades: z.array(executionSchema).default([]),
  has_more: z.boolean().optional(),
});
export type RawExecution = z.infer<typeof executionSchema>;

// ---------- 内部统一 DTO ----------
export type InternalOrderStatus =
  | "accepted"
  | "rejected"
  | "partial_filled"
  | "filled"
  | "cancelling"
  | "cancelled"
  | "expired"
  | "unknown";

/** 官方状态 → 内部状态（未知/未识别一律 unknown，绝不猜测为成功） */
export function mapBrokerStatus(status: string): InternalOrderStatus {
  switch (status) {
    case "NewStatus":
    case "WaitToNew":
    case "NotReported":
    case "ReplacedNotReported":
    case "ProtectedNotReported":
    case "VarietiesNotReported":
    case "WaitToReplace":
    case "PendingReplaceStatus":
    case "ReplacedStatus":
      return "accepted";
    case "FilledStatus":
      return "filled";
    case "PartialFilledStatus":
      return "partial_filled";
    case "WaitToCancel":
    case "PendingCancelStatus":
      return "cancelling";
    case "CanceledStatus":
    case "PartialWithdrawal":
      return "cancelled";
    case "RejectedStatus":
      return "rejected";
    case "ExpiredStatus":
      return "expired";
    default:
      return "unknown";
  }
}
