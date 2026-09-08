import { z, type ZodSchema } from "zod";
import {
  accountBalanceResponseSchema,
  candlesticksResponseSchema,
  executionsResponseSchema,
  mapBrokerStatus,
  multiQuoteResponseSchema,
  normalizeSymbol,
  orderListResponseSchema,
  quoteSchema,
  stockPositionsResponseSchema,
  submitOrderResponseSchema,
  toNumber,
  type InternalOrderStatus,
  type RawBrokerOrder,
  type RawQuote,
} from "./contract";
import { GatewayError, LongbridgeClient, getDefaultClient } from "./client";

/**
 * 领域层 Gateway：唯一允许与 Longbridge 上游对话的模块。
 * - 所有 symbol 在边界规范化；
 * - 所有上游响应经 zod 校验后才进入交易域；
 * - 数值字段无法解析时为 null（由调用方 fail-closed），绝不静默变 0。
 */

// ---------- DTO ----------
export interface Quote {
  symbol: string;
  lastDone: number | null;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  turnover: number | null;
}

export interface Candlestick {
  timestamp: string;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface AccountBalance {
  currency: string;
  totalCash: number | null;
  netAssets: number | null;
  buyPower: number | null;
  availableCash: number | null; // 指定币种（默认 USD→HKD→首项）
  cashInfos: { currency: string; availableCash: number | null }[];
}

export interface StockPosition {
  symbol: string;
  symbolName?: string;
  quantity: number | null;
  availableQuantity: number | null;
  costPrice: number | null;
  currency?: string;
  market?: string;
}

export interface BrokerOrder {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: string;
  status: InternalOrderStatus;
  brokerStatus: string;
  quantity: number | null;
  executedQuantity: number | null;
  executedPrice: number | null;
  submittedPrice: number | null;
  message?: string;
  submittedAt?: string;
}

export interface Execution {
  orderId: string;
  tradeId: string;
  symbol: string;
  tradeDoneAt: string;
  quantity: number | null;
  price: number | null;
}

export interface SubmitOrderInput {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  timeInForce: "day" | "gtc";
  remark?: string;
}

// ---------- helpers ----------
function parseWith<T>(schema: ZodSchema<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new GatewayError(
      "BAD_RESPONSE",
      `上游${what}响应校验失败: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return result.data;
}

function toIsoTime(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") {
    // 官方时间戳为秒或毫秒，做兼容
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  const n = Number(v);
  if (Number.isFinite(n) && v.trim() !== "") return toIsoTime(n);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function mapQuote(raw: RawQuote): Quote {
  return {
    symbol: raw.symbol,
    lastDone: toNumber(raw.last_done),
    prevClose: toNumber(raw.prev_close),
    open: toNumber(raw.open),
    high: toNumber(raw.high),
    low: toNumber(raw.low),
    volume: toNumber(raw.volume),
    turnover: toNumber(raw.turnover),
  };
}

function mapBrokerOrder(raw: RawBrokerOrder): BrokerOrder {
  return {
    orderId: raw.order_id,
    symbol: raw.symbol,
    side: raw.side === "Buy" ? "buy" : "sell",
    orderType: raw.order_type,
    status: mapBrokerStatus(raw.status),
    brokerStatus: raw.status,
    quantity: toNumber(raw.quantity ?? raw.submitted_quantity),
    executedQuantity: toNumber(raw.executed_quantity),
    executedPrice: toNumber(raw.executed_price),
    submittedPrice: toNumber(raw.submitted_price),
    message: raw.msg,
    submittedAt: toIsoTime(raw.submitted_at),
  };
}

// ---------- Gateway ----------
export class LongbridgeGateway {
  constructor(private readonly client: LongbridgeClient = getDefaultClient()) {}

  get configured(): boolean {
    return this.client.configured;
  }

  // ----- 行情（只读） -----
  async getQuote(symbol: string): Promise<Quote> {
    const normalized = normalizeSymbol(symbol);
    const data = await this.client.request({
      method: "GET",
      path: "/v1/quote",
      query: { symbol: normalized },
    });
    return mapQuote(parseWith(quoteSchema, data, `行情(${normalized})`));
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const normalized = symbols.map(normalizeSymbol);
    const data = await this.client.request({
      method: "POST",
      path: "/v1/quote",
      body: { symbols: normalized },
    });
    return parseWith(multiQuoteResponseSchema, data, "批量行情").list.map(mapQuote);
  }

  async getCandlesticks(
    symbol: string,
    period: "day" | "week" | "month" = "day",
    count = 100
  ): Promise<Candlestick[]> {
    const normalized = normalizeSymbol(symbol);
    const data = await this.client.request({
      method: "GET",
      path: "/v1/quote/candlesticks",
      query: { symbol: normalized, period, count, adjust_type: "no_adjust" },
    });
    const { candlesticks } = parseWith(candlesticksResponseSchema, data, `K线(${normalized})`);
    return candlesticks.map((c) => ({
      timestamp: toIsoTime(c.timestamp) ?? "",
      open: toNumber(c.open),
      close: toNumber(c.close),
      high: toNumber(c.high),
      low: toNumber(c.low),
      volume: toNumber(c.volume),
    }));
  }

  // ----- 资产（只读） -----
  async getAccountBalance(currency = "USD"): Promise<AccountBalance> {
    const data = await this.client.request({ method: "GET", path: "/v1/asset/account" });
    const { list } = parseWith(accountBalanceResponseSchema, data, "账户资产");
    const first = list[0];
    if (!first) {
      throw new GatewayError("BAD_RESPONSE", "账户资产响应为空（无账户列表）");
    }
    const cashInfos = first.cash_infos.map((c) => ({
      currency: c.currency,
      availableCash: toNumber(c.available_cash),
    }));
    const preferred =
      cashInfos.find((c) => c.currency === currency) ??
      cashInfos.find((c) => c.currency === "USD") ??
      cashInfos.find((c) => c.currency === "HKD") ??
      cashInfos[0];
    return {
      currency: first.currency,
      totalCash: toNumber(first.total_cash),
      netAssets: toNumber(first.net_assets),
      buyPower: toNumber(first.buy_power),
      availableCash: preferred?.availableCash ?? null,
      cashInfos,
    };
  }

  async getStockPositions(): Promise<StockPosition[]> {
    const data = await this.client.request({ method: "GET", path: "/v1/asset/stock" });
    const { list } = parseWith(stockPositionsResponseSchema, data, "持仓");
    return list.flatMap((channel) =>
      channel.stock_positions.map((p) => ({
        symbol: p.symbol,
        symbolName: p.symbol_name,
        quantity: toNumber(p.quantity),
        availableQuantity: toNumber(p.available_quantity),
        costPrice: toNumber(p.cost_price),
        currency: p.currency,
        market: p.market,
      }))
    );
  }

  // ----- 订单（写操作：调用方必须先通过 tradingMode 守卫） -----
  async submitOrder(input: SubmitOrderInput): Promise<{ orderId: string }> {
    const normalized = normalizeSymbol(input.symbol);
    const body: Record<string, unknown> = {
      symbol: normalized,
      order_type: input.orderType === "market" ? "MO" : "LO",
      side: input.side === "buy" ? "Buy" : "Sell",
      submitted_quantity: String(input.quantity),
      time_in_force: input.timeInForce === "day" ? "Day" : "GoodTilCanceled",
    };
    if (input.orderType === "limit") {
      if (input.limitPrice === undefined || input.limitPrice <= 0) {
        throw new GatewayError("CLIENT", "限价单必须提供正数限价");
      }
      body.submitted_price = String(input.limitPrice);
    }
    if (input.remark) body.remark = input.remark.slice(0, 64);

    const data = await this.client.request({ method: "POST", path: "/v1/trade/order", body });
    const parsed = parseWith(submitOrderResponseSchema, data, "下单");
    return { orderId: parsed.order_id };
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (!orderId) throw new GatewayError("CLIENT", "orderId 不能为空");
    await this.client.request({
      method: "DELETE",
      path: "/v1/trade/order",
      query: { order_id: orderId },
    });
  }

  // ----- 订单查询（只读） -----
  async getOrderDetail(orderId: string): Promise<BrokerOrder> {
    const data = await this.client.request({
      method: "GET",
      path: "/v1/trade/order",
      query: { order_id: orderId },
    });
    const raw = parseWith(
      z.object({
        order_id: z.string(),
        status: z.string(),
        stock_name: z.string().optional(),
        quantity: z.union([z.string(), z.number()]),
        executed_quantity: z.union([z.string(), z.number()]),
        executed_price: z.union([z.string(), z.number()]).optional(),
        submitted_price: z.union([z.string(), z.number()]).optional(),
        order_type: z.string(),
        side: z.string(),
        symbol: z.string(),
        msg: z.string().optional(),
        submitted_at: z.union([z.string(), z.number()]).optional(),
      }),
      data,
      "订单详情"
    );
    return mapBrokerOrder(raw);
  }

  async getTodayOrders(symbol?: string): Promise<BrokerOrder[]> {
    const data = await this.client.request({
      method: "GET",
      path: "/v1/trade/order/today",
      query: symbol ? { symbol: normalizeSymbol(symbol) } : {},
    });
    return parseWith(orderListResponseSchema, data, "今日订单").orders.map(mapBrokerOrder);
  }

  async getHistoryOrders(opts: { symbol?: string; startAt?: string; endAt?: string } = {}): Promise<BrokerOrder[]> {
    const data = await this.client.request({
      method: "GET",
      path: "/v1/trade/order/history",
      query: {
        symbol: opts.symbol ? normalizeSymbol(opts.symbol) : undefined,
        start_at: opts.startAt,
        end_at: opts.endAt,
      },
    });
    return parseWith(orderListResponseSchema, data, "历史订单").orders.map(mapBrokerOrder);
  }

  async getTodayExecutions(): Promise<Execution[]> {
    const data = await this.client.request({ method: "GET", path: "/v1/trade/execution/today" });
    return parseWith(executionsResponseSchema, data, "今日成交").trades.map((t) => ({
      orderId: t.order_id,
      tradeId: t.trade_id,
      symbol: t.symbol,
      tradeDoneAt: toIsoTime(t.trade_done_at) ?? "",
      quantity: toNumber(t.quantity),
      price: toNumber(t.price),
    }));
  }
}

let _defaultGateway: LongbridgeGateway | null = null;
export function getDefaultGateway(): LongbridgeGateway {
  _defaultGateway ??= new LongbridgeGateway();
  return _defaultGateway;
}
export function resetDefaultGateway(): void {
  _defaultGateway = null;
}
