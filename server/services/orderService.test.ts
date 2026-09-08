import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { auditEvents, fills, orders, positions, accountCash, trades, users } from "../../drizzle/schema";
import type { Db } from "../db";
import { OrderService } from "./orderService";
import type { LongbridgeGateway } from "./longbridge/gateway";

/**
 * 集成测试：PostgreSQL 迁移 + 交易闭环（paper 模式）
 * 使用 PGlite（WASM PostgreSQL）验证真实迁移与事务行为，无需外部数据库。
 */

let pg: PGlite;
let db: Db;
let service: OrderService;
let userId: number;

const FIXED_NOW = new Date("2026-09-08T12:00:00Z");

/** 假 gateway：只提供参考价，绝不触网 */
const fakeGateway = {
  configured: true,
  getQuote: async (symbol: string) => ({
    symbol,
    lastDone: 100,
    prevClose: 99,
    open: 99.5,
    high: 101,
    low: 98.5,
    volume: 1_000_000,
    turnover: 100_000_000,
  }),
} as unknown as LongbridgeGateway;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Db;
  // 验证真实迁移文件可在全新数据库上执行（up 方向）
  await migrate(db as never, { migrationsFolder: "drizzle" });

  const [u] = await db
    .insert(users)
    .values({ openId: "test-user", name: "tester" })
    .returning();
  userId = u.id;

  service = new OrderService({ db, gateway: fakeGateway, now: () => FIXED_NOW });
}, 60000);

afterAll(async () => {
  await pg.close();
});

describe("迁移", () => {
  it("全部表已创建", async () => {
    const res = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    const names = res.rows.map((r) => r.tablename);
    for (const t of [
      "users", "accounts", "account_cash", "watchlist", "positions",
      "orders", "fills", "trades", "ai_decisions", "risk_config", "job_runs", "audit_events",
    ]) {
      expect(names).toContain(t);
    }
  });
});

describe("paper 交易闭环", () => {
  it("市价买单：成交、持仓、现金、trades、audit 全链路", async () => {
    const result = await service.submitOrder({
      userId,
      symbol: "aapl",
      side: "buy",
      orderType: "market",
      quantity: 10,
      timeInForce: "day",
      clientOrderId: "cid-buy-1",
    });

    expect(result.status).toBe("filled");
    expect(result.mode).toBe("paper");
    expect(result.brokerOrderId).toMatch(/^PAPER-/);

    // 订单持久化
    const orderRows = await db.select().from(orders).where(eq(orders.clientOrderId, "cid-buy-1"));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("filled");
    expect(orderRows[0].symbol).toBe("AAPL.US");
    expect(Number(orderRows[0].filledQuantity)).toBe(10);

    // 成交记录
    const fillRows = await db.select().from(fills).where(eq(fills.orderId, orderRows[0].id));
    expect(fillRows).toHaveLength(1);
    expect(Number(fillRows[0].price)).toBe(100);

    // 持仓
    const posRows = await db.select().from(positions);
    expect(posRows).toHaveLength(1);
    expect(Number(posRows[0].quantity)).toBe(10);
    expect(Number(posRows[0].avgPrice)).toBe(100);

    // 现金：100000 - 1000
    const cashRows = await db.select().from(accountCash);
    expect(Number(cashRows[0].cash)).toBe(99000);

    // trades 记录
    const tradeRows = await db.select().from(trades);
    expect(tradeRows).toHaveLength(1);
    expect(Number(tradeRows[0].totalAmount)).toBe(1000);

    // 审计
    const auditRows = await db.select().from(auditEvents);
    expect(auditRows.some((a) => a.eventType === "order.filled")).toBe(true);
  });

  it("幂等：相同 clientOrderId 重复提交不产生新订单", async () => {
    const again = await service.submitOrder({
      userId,
      symbol: "aapl",
      side: "buy",
      orderType: "market",
      quantity: 10,
      timeInForce: "day",
      clientOrderId: "cid-buy-1",
    });
    expect(again.duplicate).toBe(true);
    const orderRows = await db.select().from(orders).where(eq(orders.clientOrderId, "cid-buy-1"));
    expect(orderRows).toHaveLength(1);
    // 现金未被重复扣减
    const cashRows = await db.select().from(accountCash);
    expect(Number(cashRows[0].cash)).toBe(99000);
  });

  it("风控拒绝：持久化 rejected 订单 + 审计", async () => {
    const result = await service.submitOrder({
      userId,
      symbol: "msft",
      side: "buy",
      orderType: "market",
      quantity: 500, // 500*100=50000 > 单标的暴露 10000
      timeInForce: "day",
      clientOrderId: "cid-reject-1",
    });
    expect(result.status).toBe("rejected");
    expect(result.risk.allowed).toBe(false);
    const orderRows = await db.select().from(orders).where(eq(orders.clientOrderId, "cid-reject-1"));
    expect(orderRows[0].status).toBe("rejected");
    expect(orderRows[0].rejectReason).toBeTruthy();
    const auditRows = await db.select().from(auditEvents);
    expect(auditRows.some((a) => a.eventType === "order.rejected_by_risk")).toBe(true);
  });

  it("加仓均价正确，卖出产生已实现盈亏", async () => {
    // 再买 10 股 @100 → 持仓 20 股均价 100
    await service.submitOrder({
      userId, symbol: "AAPL", side: "buy", orderType: "market",
      quantity: 10, timeInForce: "day", clientOrderId: "cid-buy-2",
    });
    // 卖出 15 股 @100 → realized = 0（均价100）；现金 98000 + 1500
    const sell = await service.submitOrder({
      userId, symbol: "AAPL", side: "sell", orderType: "market",
      quantity: 15, timeInForce: "day", clientOrderId: "cid-sell-1",
    });
    expect(sell.status).toBe("filled");

    const posRows = await db.select().from(positions);
    expect(Number(posRows[0].quantity)).toBe(5);

    const tradeRows = await db.select().from(trades).where(eq(trades.side, "sell"));
    expect(Number(tradeRows[0].realizedPnl)).toBe(0);

    const cashRows = await db.select().from(accountCash);
    expect(Number(cashRows[0].cash)).toBe(99500); // 98000 + 1500
  });

  it("限价单不成交时保持 accepted，可撤销", async () => {
    const result = await service.submitOrder({
      userId,
      symbol: "AAPL",
      side: "buy",
      orderType: "limit",
      quantity: 5,
      limitPrice: 90, // 参考价 100 > 90 → 不成交
      timeInForce: "day",
      clientOrderId: "cid-limit-1",
    });
    expect(result.status).toBe("accepted");

    const cancel = await service.cancelOrder({ userId, orderId: result.id! });
    expect(cancel.success).toBe(true);
    expect(cancel.status).toBe("cancelled");

    // 已撤销订单不可再撤
    const again = await service.cancelOrder({ userId, orderId: result.id! });
    expect(again.success).toBe(false);
  });

  it("对账：paper 限价单在价格到位后成交", async () => {
    // 挂限价卖单 limitPrice=100，参考价=100 → reconcile 应成交
    const submitted = await service.submitOrder({
      userId,
      symbol: "AAPL",
      side: "sell",
      orderType: "limit",
      quantity: 5,
      limitPrice: 110, // 当前价 100 < 110 → 不成交
      timeInForce: "gtc",
      clientOrderId: "cid-limit-sell-1",
    });
    expect(submitted.status).toBe("accepted");

    // 价格上涨到 115 的 gateway
    const risingGateway = {
      configured: true,
      getQuote: async (symbol: string) => ({
        symbol, lastDone: 115, prevClose: 100, open: 110, high: 116, low: 109, volume: 1, turnover: 1,
      }),
    } as unknown as LongbridgeGateway;
    const service2 = new OrderService({ db, gateway: risingGateway, now: () => FIXED_NOW });
    const { updated, errors } = await service2.reconcileOpenOrders(userId);
    expect(errors).toEqual([]);
    expect(updated).toBeGreaterThanOrEqual(1);

    const orderRows = await db.select().from(orders).where(eq(orders.clientOrderId, "cid-limit-sell-1"));
    expect(orderRows[0].status).toBe("filled");
    // 持仓 5 → 0，position 行被删除
    const posRows = await db.select().from(positions);
    expect(posRows).toHaveLength(0);
    // 已实现盈亏: (115-100)*5 = 75
    const sellTrades = await db.select().from(trades).where(eq(trades.side, "sell"));
    const last = sellTrades[sellTrades.length - 1];
    expect(Number(last.realizedPnl)).toBe(75);
  });

  it("kill switch：tradingHalted 后新订单被拒绝", async () => {
    const config = await service.getOrCreateRiskConfig(userId);
    await db
      .update(schema.riskConfig)
      .set({ tradingHalted: true, haltReason: "测试熔断" })
      .where(eq(schema.riskConfig.id, config.id));

    const result = await service.submitOrder({
      userId, symbol: "AAPL", side: "buy", orderType: "market",
      quantity: 1, timeInForce: "day", clientOrderId: "cid-halted-1",
    });
    expect(result.status).toBe("rejected");
    expect(result.message).toContain("kill switch");

    await db.update(schema.riskConfig).set({ tradingHalted: false, haltReason: null }).where(eq(schema.riskConfig.id, config.id));
  });

  it("账户总览返回真实账本数据", async () => {
    const overview = await service.getAccountOverview(userId);
    expect(overview.mode).toBe("paper");
    // 现金: 99500 + 5*115 = 100075
    expect(overview.cash).toBe(100075);
    expect(overview.complete).toBe(true);
  });
});
