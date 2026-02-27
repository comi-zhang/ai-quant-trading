import { pgTable, serial, text, timestamp, varchar, decimal, boolean, pgEnum } from "drizzle-orm/pg-core";

// User roles enum
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const sideEnum = pgEnum("side", ["buy", "sell"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit"]);
export const orderStatusEnum = pgEnum("status", ["pending", "filled", "partial", "cancelled", "rejected"]);
export const actionEnum = pgEnum("action", ["buy", "sell", "hold"]);

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Watchlist table - stores monitored stocks
 */
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  name: text("name"),
  market: varchar("market", { length: 10 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = typeof watchlist.$inferInsert;

/**
 * Positions table - stores current holdings
 */
export const positions = pgTable("positions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  avgPrice: decimal("avg_price", { precision: 18, scale: 4 }).notNull(),
  currentPrice: decimal("current_price", { precision: 18, scale: 4 }),
  marketValue: decimal("market_value", { precision: 18, scale: 2 }),
  unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 2 }),
  unrealizedPnlPercent: decimal("unrealized_pnl_percent", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

/**
 * Trades table - stores trade history
 */
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: sideEnum("side").notNull(),
  orderType: orderTypeEnum("order_type").notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 4 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).notNull(),
  status: orderStatusEnum("status").default("pending").notNull(),
  orderId: varchar("order_id", { length: 100 }),
  executedAt: timestamp("executed_at"),
  aiDecisionId: integer("ai_decision_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

/**
 * AI Decisions table - stores AI decision logs
 */
export const aiDecisions = pgTable("ai_decisions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  action: actionEnum("action").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  reasoning: text("reasoning"),
  fundamentalScore: decimal("fundamental_score", { precision: 5, scale: 2 }),
  sentimentScore: decimal("sentiment_score", { precision: 5, scale: 2 }),
  technicalScore: decimal("technical_score", { precision: 5, scale: 2 }),
  fundamentalData: text("fundamental_data"),
  sentimentData: text("sentiment_data"),
  technicalData: text("technical_data"),
  recommendedPrice: decimal("recommended_price", { precision: 18, scale: 4 }),
  recommendedQuantity: decimal("recommended_quantity", { precision: 18, scale: 8 }),
  executed: boolean("executed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiDecision = typeof aiDecisions.$inferSelect;
export type InsertAiDecision = typeof aiDecisions.$inferInsert;

/**
 * Risk Config table - stores risk management parameters
 */
export const riskConfig = pgTable("risk_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  maxPositionSize: decimal("max_position_size", { precision: 18, scale: 2 }).notNull(),
  maxTotalExposure: decimal("max_total_exposure", { precision: 18, scale: 2 }).notNull(),
  stopLossPercent: decimal("stop_loss_percent", { precision: 5, scale: 2 }).notNull(),
  takeProfitPercent: decimal("take_profit_percent", { precision: 5, scale: 2 }).notNull(),
  maxDailyTrades: serial("max_daily_trades").notNull(),
  enableAutoTrading: boolean("enable_auto_trading").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RiskConfig = typeof riskConfig.$inferSelect;
export type InsertRiskConfig = typeof riskConfig.$inferInsert;

/**
 * API Keys table - stores encrypted API credentials
 */
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  provider: varchar("provider", { length: 50 }).notNull(),
  keyName: varchar("key_name", { length: 100 }).notNull(),
  keyValue: text("key_value").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// Helper for integer
function integer(name: string) {
  return serial(name);
}
