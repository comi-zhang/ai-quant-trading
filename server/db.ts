import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../drizzle/schema";
import {
  InsertUser,
  users,
  accounts,
  orders,
  fills,
  trades,
  positions,
  accountCash,
  auditEvents,
  riskConfig,
  aiDecisions,
  type InsertAuditEvent,
  type InsertOrder,
  type InsertFill,
  type InsertTrade,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

let _db: Db | null = null;
let _pool: pg.Pool | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb(): Promise<Db | null> {
  if (!_db && ENV.databaseUrl) {
    try {
      _pool = new Pool({ connectionString: ENV.databaseUrl, max: 10 });
      // 立即验证连接，失败不缓存
      await _pool.query("SELECT 1");
      _db = drizzle(_pool, { schema });
    } catch (error) {
      console.warn("[Database] Failed to connect:", (error as Error).message);
      _pool = null;
      _db = null;
    }
  }
  return _db;
}

/** 测试/关闭时释放连接池 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end().catch(() => undefined);
  }
  _pool = null;
  _db = null;
}

// ============ Users ============

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const updateSet: Record<string, unknown> = {};
  const values: InsertUser = { openId: user.openId };

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    values[field] = value ?? null;
    updateSet[field] = value ?? null;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) {
    values.lastSignedIn = new Date();
  }
  if (Object.keys(updateSet).length === 0) {
    updateSet.lastSignedIn = new Date();
  }

  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ Accounts ============

/** 获取或创建用户指定模式的默认账户（账户隔离的基础） */
export async function getOrCreateAccount(userId: number, mode: "paper" | "live" = "paper") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.mode, mode), eq(accounts.label, "default")))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(accounts)
    .values({ userId, mode, label: "default" })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  // 并发下已由其他请求创建
  const retry = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.mode, mode), eq(accounts.label, "default")))
    .limit(1);
  if (!retry[0]) throw new Error("Failed to create account");
  return retry[0];
}

// ============ Risk Config ============

export async function getRiskConfig(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(riskConfig).where(eq(riskConfig.userId, userId)).limit(1);
  return rows[0];
}

// ============ Orders ============

/** 按幂等键查找订单 */
export async function getOrderByClientId(accountId: number, clientOrderId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.accountId, accountId), eq(orders.clientOrderId, clientOrderId)))
    .limit(1);
  return rows[0];
}

/** 统计账户当日订单数（风控：日交易次数） */
export async function countTodayOrders(accountId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.accountId, accountId), sql`${orders.createdAt} >= date_trunc('day', now())`));
  return rows[0]?.count ?? 0;
}

// ============ Audit ============

export async function recordAudit(event: InsertAuditEvent): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Audit] database not available, event dropped:", event.eventType);
    return;
  }
  try {
    await db.insert(auditEvents).values(event);
  } catch (error) {
    // 审计写入失败不应中断主流程，但必须可见
    console.error("[Audit] failed to record event:", event.eventType, (error as Error).message);
  }
}

/** 查询最近审计事件（调试用） */
export async function listAuditEvents(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.userId, userId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}

// ============ Account Cash ============

export const PAPER_INITIAL_CASH = "100000";

export async function getOrCreateAccountCash(accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(accountCash).where(eq(accountCash.accountId, accountId)).limit(1);
  if (rows[0]) return rows[0];
  const inserted = await db
    .insert(accountCash)
    .values({ accountId, cash: PAPER_INITIAL_CASH })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const retry = await db.select().from(accountCash).where(eq(accountCash.accountId, accountId)).limit(1);
  if (!retry[0]) throw new Error("Failed to init account cash");
  return retry[0];
}

// ============ Positions ============

export async function listPositions(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(positions).where(eq(positions.accountId, accountId));
}

// ============ Orders / Fills / Trades 查询 ============

export async function listOrders(accountId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orders)
    .where(eq(orders.accountId, accountId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

export async function listOpenOrders(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.accountId, accountId),
        sql`${orders.status} IN ('pending_accept','accepted','partial_filled','cancelling','unknown')`
      )
    )
    .orderBy(desc(orders.createdAt));
}

export async function listTrades(accountId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(trades)
    .where(eq(trades.accountId, accountId))
    .orderBy(desc(trades.executedAt))
    .limit(limit);
}

/** 当日已实现盈亏（卖出成交额 - 卖出数量*持仓均价的简化核算在 orderService 中逐笔计算；
 *  这里提供当日卖出总额与买入总额，供风控做日亏损熔断的保守估计） */
export async function getTodayTradeTotals(accountId: number) {
  const db = await getDb();
  if (!db) return { buyTotal: 0, sellTotal: 0 };
  const rows = await db
    .select({
      side: trades.side,
      total: sql<string>`coalesce(sum(${trades.totalAmount}), '0')`,
    })
    .from(trades)
    .where(and(eq(trades.accountId, accountId), sql`${trades.executedAt} >= date_trunc('day', now())`))
    .groupBy(trades.side);
  let buyTotal = 0;
  let sellTotal = 0;
  for (const r of rows) {
    if (r.side === "buy") buyTotal = Number(r.total);
    if (r.side === "sell") sellTotal = Number(r.total);
  }
  return { buyTotal, sellTotal };
}

// ============ AI Decisions ============

export async function insertAiDecision(values: typeof aiDecisions.$inferInsert) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.insert(aiDecisions).values(values).returning();
  return rows[0];
}

export async function listAiDecisions(userId: number, opts: { limit?: number; symbol?: string } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(aiDecisions.userId, userId)];
  if (opts.symbol) conds.push(eq(aiDecisions.symbol, opts.symbol));
  return db
    .select()
    .from(aiDecisions)
    .where(and(...conds))
    .orderBy(desc(aiDecisions.createdAt))
    .limit(opts.limit ?? 20);
}

export type { InsertOrder, InsertFill, InsertTrade };
