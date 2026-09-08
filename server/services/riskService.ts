import { eq } from "drizzle-orm";
import { riskConfig, type RiskConfig } from "../../drizzle/schema";
import { getDb } from "../db";

/**
 * 风险配置服务：服务端持久化 + 版本号 + 审计由调用方记录。
 */

export interface RiskConfigUpdate {
  maxPositionSize?: number;
  maxTotalExposure?: number;
  maxOrderQuantity?: number;
  maxDailyTrades?: number;
  maxDailyLoss?: number;
  minAccountBalance?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  enableAutoTrading?: boolean;
}

const DEFAULTS = {
  maxPositionSize: "10000",
  maxTotalExposure: "50000",
  maxOrderQuantity: 1000,
  maxDailyTrades: 20,
  maxDailyLoss: "2000",
  minAccountBalance: "5000",
  stopLossPercent: "2",
  takeProfitPercent: "5",
};

export async function getOrCreateRiskConfig(userId: number): Promise<RiskConfig | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(riskConfig).where(eq(riskConfig.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const inserted = await db
    .insert(riskConfig)
    .values({ userId, ...DEFAULTS })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const retry = await db.select().from(riskConfig).where(eq(riskConfig.userId, userId)).limit(1);
  return retry[0] ?? null;
}

/** 更新风险配置（乐观锁：版本号递增；返回更新后的配置） */
export async function updateRiskConfig(userId: number, update: RiskConfigUpdate): Promise<RiskConfig | null> {
  const db = await getDb();
  if (!db) return null;
  const current = await getOrCreateRiskConfig(userId);
  if (!current) return null;

  const set: Record<string, unknown> = { updatedAt: new Date(), version: current.version + 1 };
  if (update.maxPositionSize !== undefined) set.maxPositionSize = String(update.maxPositionSize);
  if (update.maxTotalExposure !== undefined) set.maxTotalExposure = String(update.maxTotalExposure);
  if (update.maxOrderQuantity !== undefined) set.maxOrderQuantity = update.maxOrderQuantity;
  if (update.maxDailyTrades !== undefined) set.maxDailyTrades = update.maxDailyTrades;
  if (update.maxDailyLoss !== undefined) set.maxDailyLoss = String(update.maxDailyLoss);
  if (update.minAccountBalance !== undefined) set.minAccountBalance = String(update.minAccountBalance);
  if (update.stopLossPercent !== undefined) set.stopLossPercent = String(update.stopLossPercent);
  if (update.takeProfitPercent !== undefined) set.takeProfitPercent = String(update.takeProfitPercent);
  if (update.enableAutoTrading !== undefined) set.enableAutoTrading = update.enableAutoTrading;

  const rows = await db.update(riskConfig).set(set).where(eq(riskConfig.userId, userId)).returning();
  return rows[0] ?? null;
}

/** kill switch：暂停/恢复（审计由路由层记录） */
export async function setTradingHalted(userId: number, halted: boolean, reason?: string): Promise<RiskConfig | null> {
  const db = await getDb();
  if (!db) return null;
  await getOrCreateRiskConfig(userId);
  const rows = await db
    .update(riskConfig)
    .set({ tradingHalted: halted, haltReason: halted ? (reason ?? "manual") : null, updatedAt: new Date() })
    .where(eq(riskConfig.userId, userId))
    .returning();
  return rows[0] ?? null;
}
