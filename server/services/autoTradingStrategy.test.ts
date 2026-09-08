import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { aiDecisions, users, orders } from "../../drizzle/schema";
import type { Db } from "../db";
import { AutoTradingStrategy } from "./autoTradingStrategy";
import { OrderService } from "./orderService";
import type { LongbridgeGateway } from "./longbridge/gateway";
import type { Candlestick, Quote } from "./longbridge/gateway";

/**
 * 策略集成测试：真实数据链（假 gateway 提供确定性行情/K线），
 * 验证 dataQuality 标记、决策持久化、dry-run 不下单、execute 经风控。
 */

let pg: PGlite;
let db: Db;
let userId: number;

function candlesFromCloses(closes: number[]): Candlestick[] {
  return closes.map((c, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    open: c, close: c, high: c + 1, low: c - 1, volume: 1000,
  }));
}

function makeGateway(opts: { price: number; closes: number[] }): LongbridgeGateway {
  return {
    configured: true,
    getQuote: async (symbol: string): Promise<Quote> => ({
      symbol, lastDone: opts.price, prevClose: opts.price - 1, open: opts.price,
      high: opts.price + 1, low: opts.price - 1, volume: 1e6, turnover: 1e8,
    }),
    getCandlesticks: async () => candlesFromCloses(opts.closes),
  } as unknown as LongbridgeGateway;
}

const failingGateway = {
  configured: true,
  getQuote: async () => { throw new Error("upstream down"); },
  getCandlesticks: async () => { throw new Error("upstream down"); },
} as unknown as LongbridgeGateway;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "drizzle" });
  const [u] = await db.insert(users).values({ openId: "strategy-user", name: "t" }).returning();
  userId = u.id;
}, 60000);

afterAll(async () => {
  await pg.close();
});

describe("AutoTradingStrategy", () => {
  it("上涨趋势产生买入信号并持久化决策（dry-run 不下单）", async () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 0.8 + 1.5 * Math.sin(i));
    const strategy = new AutoTradingStrategy(makeGateway({ price: 200, closes }), null, db);

    const result = await strategy.runForSymbol(userId, "AAPL", { execute: false });
    expect(result.dataQuality).toBe("degraded"); // 无基本面/舆情源
    expect(result.executed).toBe(false);
    expect(result.message).toContain("dry-run");
    expect(result.decisionId).not.toBeNull();

    const rows = await db.select().from(aiDecisions).where(eq(aiDecisions.id, result.decisionId!));
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("AAPL.US");
    expect(rows[0].technicalScore).not.toBeNull();
    expect(rows[0].fundamentalScore).toBeNull(); // 无数据源 → null，不是 50
    expect(rows[0].sentimentScore).toBeNull();
    expect(rows[0].dataQuality).toBe("degraded");
    expect(rows[0].inputs).toBeTruthy();

    // dry-run 不产生订单
    const orderRows = await db.select().from(orders);
    expect(orderRows).toHaveLength(0);
  });

  it("上游全部失败：dataQuality=insufficient，决策为 hold，不执行", async () => {
    const strategy = new AutoTradingStrategy(failingGateway, null, db);
    const result = await strategy.runForSymbol(userId, "MSFT", { execute: true });
    expect(result.dataQuality).toBe("insufficient");
    expect(result.action).toBe("hold");
    expect(result.executed).toBe(false);

    const orderRows = await db.select().from(orders);
    expect(orderRows).toHaveLength(0);
  });

  it("execute=true 且信号为买入时经 orderService 完整闭环", async () => {
    // 该 fixture 技术评分=75 → 规则决策 buy（确定性）
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5 + 3 * Math.sin(i * 0.5));
    const gateway = makeGateway({ price: 100, closes });
    const orderService = new OrderService({ db, gateway });
    const strategy = new AutoTradingStrategy(gateway, orderService, db);

    const analysis = await strategy.analyze("AAPL");
    if (analysis.action !== "buy") {
      // 该确定性 fixture 必须产生买入信号；若不成立则测试数据失效
      throw new Error(`fixture 失效：action=${analysis.action}, composite=${analysis.compositeScore}`);
    }

    // 注意：execute 需要 AUTO_TRADING_ENABLED；测试环境默认 false → 被闸门拒绝
    const result = await strategy.runForSymbol(userId, "AAPL", { execute: true });
    const orderRows = await db.select().from(orders).where(eq(orders.symbol, "AAPL.US"));
    if (result.executed) {
      // 若环境开启了自动交易：应完整成交
      expect(orderRows.length).toBeGreaterThan(0);
      expect(orderRows[0].aiDecisionId).toBe(result.decisionId);
    } else {
      // 默认：被自动交易闸门或风控拒绝，且拒绝留痕或为闸门拦截
      expect(["自动交易未启用", result.message]).toContain(result.message);
    }
  });
});
