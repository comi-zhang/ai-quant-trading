import { describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { GatewayError, LongbridgeClient, type RawResponse } from "./client";
import { LongbridgeGateway } from "./gateway";
import { mapBrokerStatus, normalizeSymbol } from "./contract";
import { executePaperOrder } from "./paperBroker";

// ---------- 测试辅助 ----------

/** 独立重写的官方签名算法（与 client.ts 实现分离，用于交叉验证） */
function independentSign(params: {
  method: string;
  path: string;
  query: string;
  body?: string;
  token: string;
  key: string;
  secret: string;
  ts: string;
}): string {
  const sha1 = (s: string) => crypto.createHash("sha1").update(s, "utf8").digest("hex");
  const signedHeaders = "authorization;x-api-key;x-timestamp";
  const signedValues = `authorization:${params.token}\nx-api-key:${params.key}\nx-timestamp:${params.ts}\n`;
  let s = `${params.method}|${params.path}|${params.query}|${signedValues}|${signedHeaders}|`;
  if (params.body) s += sha1(params.body);
  const finalStr = `HMAC-SHA256|${sha1(s)}`;
  const sig = crypto.createHmac("sha256", params.secret).update(finalStr, "utf8").digest("hex");
  return `HMAC-SHA256 SignedHeaders=${signedHeaders}, Signature=${sig}`;
}

const TEST_CREDS = {
  accessToken: "test-token",
  appKey: "test-app-key",
  appSecret: "test-app-secret",
};

function makeClient(handler: (req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => RawResponse | Promise<RawResponse>) {
  const transport = vi.fn(handler);
  const client = new LongbridgeClient({
    ...TEST_CREDS,
    baseUrl: "https://openapi.longportapp.com",
    transport,
    now: () => 1_700_000_000_000, // 固定时间戳使签名可重现
  });
  return { client, transport };
}

const okEnvelope = (data: unknown): RawResponse => ({
  status: 200,
  headers: {},
  text: JSON.stringify({ code: 0, message: "success", data }),
});

// ---------- 签名 ----------

describe("LongbridgeClient 签名", () => {
  it("GET 请求签名与官方算法一致", async () => {
    const { client, transport } = makeClient(() => okEnvelope({ ok: true }));
    await client.request({ method: "GET", path: "/v1/asset/account" });

    const req = transport.mock.calls[0][0];
    expect(req.headers["Authorization"]).toBe(TEST_CREDS.accessToken);
    expect(req.headers["X-Api-Key"]).toBe(TEST_CREDS.appKey);
    expect(req.headers["X-Timestamp"]).toBe("1700000000");
    expect(req.headers["X-Api-Signature"]).toBe(
      independentSign({
        method: "GET",
        path: "/v1/asset/account",
        query: "",
        ...{ token: TEST_CREDS.accessToken, key: TEST_CREDS.appKey, secret: TEST_CREDS.appSecret, ts: "1700000000" },
      })
    );
  });

  it("POST 请求带 query 与 body 时签名包含其 sha1", async () => {
    const { client, transport } = makeClient(() => okEnvelope({ order_id: "123" }));
    const body = { symbol: "AAPL.US", side: "Buy" };
    await client.request({ method: "POST", path: "/v1/trade/order", query: { a: "1", b: "2" }, body });

    const req = transport.mock.calls[0][0];
    expect(req.headers["X-Api-Signature"]).toBe(
      independentSign({
        method: "POST",
        path: "/v1/trade/order",
        query: "a=1&b=2",
        body: JSON.stringify(body),
        token: TEST_CREDS.accessToken,
        key: TEST_CREDS.appKey,
        secret: TEST_CREDS.appSecret,
        ts: "1700000000",
      })
    );
  });

  it("凭据缺失时 fail closed", async () => {
    const client = new LongbridgeClient({ accessToken: "", appKey: "", appSecret: "", transport: vi.fn() });
    await expect(client.request({ method: "GET", path: "/v1/quote" })).rejects.toMatchObject({
      kind: "AUTH",
    });
  });
});

// ---------- Envelope / 错误 ----------

describe("Envelope 与错误分类", () => {
  it("code=0 返回 data", async () => {
    const { client } = makeClient(() => okEnvelope({ hello: "world" }));
    await expect(client.request({ method: "GET", path: "/x" })).resolves.toEqual({ hello: "world" });
  });

  it("业务错误码抛出 UPSTREAM 且带 trace id", async () => {
    const { client } = makeClient(() => ({
      status: 200,
      headers: { "x-trace-id": "trace-abc" },
      text: JSON.stringify({ code: 602010, message: "order rejected" }),
    }));
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toMatchObject({
      kind: "UPSTREAM",
      opts: { apiCode: 602010, traceId: "trace-abc" },
    });
  });

  it("429 触发指数退避重试并最终成功", async () => {
    let calls = 0;
    const { client, transport } = makeClient(() => {
      calls++;
      if (calls < 3) return { status: 429, headers: {}, text: "" };
      return okEnvelope({ ok: true });
    });
    await expect(client.request({ method: "GET", path: "/x" })).resolves.toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(3);
  }, 15000);

  it("429 超过重试次数抛 RATE_LIMIT", async () => {
    const { client } = makeClient(() => ({ status: 429, headers: {}, text: "" }));
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toMatchObject({
      kind: "RATE_LIMIT",
    });
  }, 15000);

  it("200 但非 JSON 抛 BAD_RESPONSE", async () => {
    const { client } = makeClient(() => ({ status: 200, headers: {}, text: "<html/>" }));
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toMatchObject({
      kind: "BAD_RESPONSE",
    });
  });

  it("500 抛 UPSTREAM", async () => {
    const { client } = makeClient(() => ({ status: 500, headers: {}, text: "boom" }));
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toMatchObject({
      kind: "UPSTREAM",
    });
  });
});

// ---------- Symbol / 状态映射 ----------

describe("symbol 规范化与状态映射", () => {
  it("裸代码补 .US，大小写统一", () => {
    expect(normalizeSymbol("aapl")).toBe("AAPL.US");
    expect(normalizeSymbol("700.hk")).toBe("700.HK");
    expect(normalizeSymbol(" AAPL.US ")).toBe("AAPL.US");
  });

  it("非法 symbol 拒绝", () => {
    expect(() => normalizeSymbol("")).toThrow();
    expect(() => normalizeSymbol("AAPL;DROP")).toThrow();
  });

  it("官方状态映射到内部状态", () => {
    expect(mapBrokerStatus("NewStatus")).toBe("accepted");
    expect(mapBrokerStatus("FilledStatus")).toBe("filled");
    expect(mapBrokerStatus("PartialFilledStatus")).toBe("partial_filled");
    expect(mapBrokerStatus("PendingCancelStatus")).toBe("cancelling");
    expect(mapBrokerStatus("CanceledStatus")).toBe("cancelled");
    expect(mapBrokerStatus("RejectedStatus")).toBe("rejected");
    expect(mapBrokerStatus("ExpiredStatus")).toBe("expired");
    expect(mapBrokerStatus("something-else")).toBe("unknown");
  });
});

// ---------- Gateway 契约 ----------

function gatewayWith(handler: Parameters<typeof makeClient>[0]) {
  const { client, transport } = makeClient(handler);
  return { gateway: new LongbridgeGateway(client), transport };
}

describe("Gateway 契约", () => {
  it("getQuote: 路径/query 正确且响应经校验", async () => {
    const { gateway, transport } = gatewayWith(() =>
      okEnvelope({
        symbol: "AAPL.US",
        last_done: "189.5",
        prev_close: "188.0",
        open: "188.5",
        high: "190.0",
        low: "187.9",
        volume: "1000000",
        turnover: "189000000",
      })
    );
    const quote = await gateway.getQuote("aapl");
    expect(quote.symbol).toBe("AAPL.US");
    expect(quote.lastDone).toBe(189.5);
    const req = transport.mock.calls[0][0];
    expect(req.url).toBe("https://openapi.longportapp.com/v1/quote?symbol=AAPL.US");
    expect(req.method).toBe("GET");
  });

  it("getQuote: 字段缺失时校验失败（不伪造数据）", async () => {
    const { gateway } = gatewayWith(() => okEnvelope({ symbol: "AAPL.US" }));
    await expect(gateway.getQuote("AAPL")).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });

  it("getAccountBalance: 解析多币种现金，优先 USD", async () => {
    const { gateway } = gatewayWith(() =>
      okEnvelope({
        list: [
          {
            total_cash: "100000",
            net_assets: "120000",
            buy_power: "90000",
            currency: "USD",
            cash_infos: [
              { currency: "HKD", available_cash: "5000" },
              { currency: "USD", available_cash: "95000" },
            ],
          },
        ],
      })
    );
    const bal = await gateway.getAccountBalance();
    expect(bal.availableCash).toBe(95000);
    expect(bal.netAssets).toBe(120000);
    expect(bal.cashInfos).toHaveLength(2);
  });

  it("getAccountBalance: 空账户列表 fail closed", async () => {
    const { gateway } = gatewayWith(() => okEnvelope({ list: [] }));
    await expect(gateway.getAccountBalance()).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });

  it("getStockPositions: 展开 channel 结构", async () => {
    const { gateway } = gatewayWith(() =>
      okEnvelope({
        list: [
          {
            account_channel: "lb_papertrading",
            stock_positions: [
              { symbol: "AAPL.US", symbol_name: "苹果", quantity: "100", available_quantity: "80", cost_price: "150.5", currency: "USD", market: "US" },
            ],
          },
        ],
      })
    );
    const positions = await gateway.getStockPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ symbol: "AAPL.US", quantity: 100, availableQuantity: 80 });
  });

  it("submitOrder 市价单：请求体符合官方契约", async () => {
    const { gateway, transport } = gatewayWith(() => okEnvelope({ order_id: "9001" }));
    const result = await gateway.submitOrder({
      symbol: "aapl",
      side: "buy",
      orderType: "market",
      quantity: 10,
      timeInForce: "day",
    });
    expect(result.orderId).toBe("9001");
    const req = transport.mock.calls[0][0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://openapi.longportapp.com/v1/trade/order");
    expect(JSON.parse(req.body!)).toEqual({
      symbol: "AAPL.US",
      order_type: "MO",
      side: "Buy",
      submitted_quantity: "10",
      time_in_force: "Day",
    });
  });

  it("submitOrder 限价单：包含 submitted_price，GTC 映射正确", async () => {
    const { gateway, transport } = gatewayWith(() => okEnvelope({ order_id: "9002" }));
    await gateway.submitOrder({
      symbol: "700.HK",
      side: "sell",
      orderType: "limit",
      quantity: 200,
      limitPrice: 385.5,
      timeInForce: "gtc",
    });
    const req = transport.mock.calls[0][0];
    expect(JSON.parse(req.body!)).toEqual({
      symbol: "700.HK",
      order_type: "LO",
      side: "Sell",
      submitted_quantity: "200",
      submitted_price: "385.5",
      time_in_force: "GoodTilCanceled",
    });
  });

  it("submitOrder 限价单缺价格：本地拒绝，不发请求", async () => {
    const { gateway, transport } = gatewayWith(() => okEnvelope({}));
    await expect(
      gateway.submitOrder({ symbol: "AAPL", side: "buy", orderType: "limit", quantity: 1, timeInForce: "day" })
    ).rejects.toMatchObject({ kind: "CLIENT" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("cancelOrder: DELETE + query order_id", async () => {
    const { gateway, transport } = gatewayWith(() => okEnvelope({}));
    await gateway.cancelOrder("9001");
    const req = transport.mock.calls[0][0];
    expect(req.method).toBe("DELETE");
    expect(req.url).toBe("https://openapi.longportapp.com/v1/trade/order?order_id=9001");
  });

  it("getTodayOrders: envelope 缺 orders 字段按空列表处理", async () => {
    const { gateway } = gatewayWith(() => okEnvelope({}));
    await expect(gateway.getTodayOrders()).resolves.toEqual([]);
  });

  it("getTodayOrders: 状态字符串映射为内部状态", async () => {
    const { gateway } = gatewayWith(() =>
      okEnvelope({
        orders: [
          { order_id: "1", status: "FilledStatus", quantity: "10", executed_quantity: "10", order_type: "MO", side: "Buy", symbol: "AAPL.US" },
          { order_id: "2", status: "NewStatus", quantity: "5", executed_quantity: "0", order_type: "LO", side: "Sell", symbol: "MSFT.US" },
        ],
      })
    );
    const orders = await gateway.getTodayOrders();
    expect(orders[0].status).toBe("filled");
    expect(orders[1].status).toBe("accepted");
  });

  it("getTodayExecutions: 解析成交流水", async () => {
    const { gateway } = gatewayWith(() =>
      okEnvelope({
        trades: [
          { order_id: "1", trade_id: "t1", symbol: "AAPL.US", trade_done_at: "1700000000", quantity: "10", price: "189.5" },
        ],
      })
    );
    const execs = await gateway.getTodayExecutions();
    expect(execs[0]).toMatchObject({ tradeId: "t1", quantity: 10, price: 189.5 });
  });

  it("错误信息不含凭据", async () => {
    const { gateway } = gatewayWith(() => ({
      status: 200,
      headers: {},
      text: JSON.stringify({ code: 401003, message: "invalid signature" }),
    }));
    const err = await gateway.getQuote("AAPL").catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    const s = JSON.stringify(err);
    expect(s).not.toContain(TEST_CREDS.accessToken);
    expect(s).not.toContain(TEST_CREDS.appKey);
    expect(s).not.toContain(TEST_CREDS.appSecret);
  });
});

// ---------- Paper Broker ----------

describe("PaperBroker", () => {
  const base = { symbol: "AAPL", side: "buy" as const, quantity: 10, timeInForce: "day" as const };

  it("市价单以参考价立即成交", () => {
    const r = executePaperOrder({ ...base, orderType: "market" }, 189.5, new Date("2026-01-01"));
    expect(r.status).toBe("filled");
    expect(r.filledQuantity).toBe(10);
    expect(r.avgFillPrice).toBe(189.5);
    expect(r.fills).toHaveLength(1);
    expect(r.brokerOrderId).toMatch(/^PAPER-/);
  });

  it("限价买单：价内成交，价外保持 accepted", () => {
    expect(executePaperOrder({ ...base, orderType: "limit", limitPrice: 190 }, 189.5).status).toBe("filled");
    const r = executePaperOrder({ ...base, orderType: "limit", limitPrice: 180 }, 189.5);
    expect(r.status).toBe("accepted");
    expect(r.fills).toHaveLength(0);
  });

  it("限价卖单：价内成交，价外保持 accepted", () => {
    const sell = { ...base, side: "sell" as const, orderType: "limit" as const, limitPrice: 180 };
    expect(executePaperOrder(sell, 189.5).status).toBe("filled");
    expect(executePaperOrder({ ...sell, limitPrice: 200 }, 189.5).status).toBe("accepted");
  });

  it("无参考价时不成交", () => {
    const r = executePaperOrder({ ...base, orderType: "market" }, null);
    expect(r.status).toBe("accepted");
    expect(r.avgFillPrice).toBeNull();
  });

  it("非法数量抛错", () => {
    expect(() => executePaperOrder({ ...base, orderType: "market", quantity: 0 }, 100)).toThrow();
    expect(() => executePaperOrder({ ...base, orderType: "market", quantity: NaN }, 100)).toThrow();
  });
});
