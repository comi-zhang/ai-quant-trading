import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Watchlist table - stores monitored stocks
 */
export const watchlist = mysqlTable("watchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., "AAPL.US"
  name: text("name"), // Stock name
  market: varchar("market", { length: 10 }).notNull(), // "US", "HK"
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = typeof watchlist.$inferInsert;

/**
 * Positions table - stores current holdings
 */
export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  avgPrice: decimal("avgPrice", { precision: 18, scale: 4 }).notNull(), // Average purchase price
  currentPrice: decimal("currentPrice", { precision: 18, scale: 4 }), // Latest price
  marketValue: decimal("marketValue", { precision: 18, scale: 2 }), // Current market value
  unrealizedPnl: decimal("unrealizedPnl", { precision: 18, scale: 2 }), // Unrealized profit/loss
  unrealizedPnlPercent: decimal("unrealizedPnlPercent", { precision: 10, scale: 4 }), // Unrealized P&L percentage
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

/**
 * Trades table - stores trade history
 */
export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  orderType: mysqlEnum("orderType", ["market", "limit"]).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 4 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 18, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pending", "filled", "partial", "cancelled", "rejected"]).default("pending").notNull(),
  orderId: varchar("orderId", { length: 100 }), // Longbridge order ID
  executedAt: timestamp("executedAt"),
  aiDecisionId: int("aiDecisionId"), // Link to AI decision
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

/**
 * AI Decisions table - stores AI decision logs
 */
export const aiDecisions = mysqlTable("aiDecisions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  action: mysqlEnum("action", ["buy", "sell", "hold"]).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }), // 0-100
  reasoning: text("reasoning"), // AI reasoning text
  fundamentalScore: decimal("fundamentalScore", { precision: 5, scale: 2 }), // 0-100
  sentimentScore: decimal("sentimentScore", { precision: 5, scale: 2 }), // 0-100
  technicalScore: decimal("technicalScore", { precision: 5, scale: 2 }), // 0-100
  fundamentalData: text("fundamentalData"), // JSON string of fundamental data
  sentimentData: text("sentimentData"), // JSON string of news sentiment
  technicalData: text("technicalData"), // JSON string of technical indicators
  recommendedPrice: decimal("recommendedPrice", { precision: 18, scale: 4 }),
  recommendedQuantity: decimal("recommendedQuantity", { precision: 18, scale: 8 }),
  executed: boolean("executed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiDecision = typeof aiDecisions.$inferSelect;
export type InsertAiDecision = typeof aiDecisions.$inferInsert;

/**
 * Risk Config table - stores risk management parameters
 */
export const riskConfig = mysqlTable("riskConfig", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  maxPositionSize: decimal("maxPositionSize", { precision: 18, scale: 2 }).notNull(), // Max single position value
  maxTotalExposure: decimal("maxTotalExposure", { precision: 18, scale: 2 }).notNull(), // Max total exposure
  stopLossPercent: decimal("stopLossPercent", { precision: 5, scale: 2 }).notNull(), // Stop loss percentage
  takeProfitPercent: decimal("takeProfitPercent", { precision: 5, scale: 2 }).notNull(), // Take profit percentage
  maxDailyTrades: int("maxDailyTrades").notNull(), // Max trades per day
  enableAutoTrading: boolean("enableAutoTrading").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RiskConfig = typeof riskConfig.$inferSelect;
export type InsertRiskConfig = typeof riskConfig.$inferInsert;

/**
 * API Keys table - stores encrypted API credentials
 */
export const apiKeys = mysqlTable("apiKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 50 }).notNull(), // "longbridge", "alphavantage", "stocknews", "marketaux"
  keyName: varchar("keyName", { length: 100 }).notNull(), // e.g., "APP_KEY", "API_KEY"
  keyValue: text("keyValue").notNull(), // Encrypted value
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
