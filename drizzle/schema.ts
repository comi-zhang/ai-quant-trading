import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  timestamp,
  varchar,
  numeric,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ============ Enums ============
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const sideEnum = pgEnum("side", ["buy", "sell"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit"]);
export const timeInForceEnum = pgEnum("time_in_force", ["day", "gtc"]);
/**
 * 订单状态机：
 * pending_accept  已校验待提交（本地）
 * accepted        券商已接受
 * rejected        券商/风控拒绝
 * partial_filled  部分成交
 * filled          全部成交
 * cancelling      撤单中
 * cancelled       已撤销
 * expired         已过期
 * unknown         状态未知（对账失败/超时）——必须人工介入
 */
export const orderStatusEnum = pgEnum("order_status", [
  "pending_accept",
  "accepted",
  "rejected",
  "partial_filled",
  "filled",
  "cancelling",
  "cancelled",
  "expired",
  "unknown",
]);
export const actionEnum = pgEnum("action", ["buy", "sell", "hold"]);
export const accountModeEnum = pgEnum("account_mode", ["paper", "live"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "paused"]);
export const jobStatusEnum = pgEnum("job_status", [
  "running",
  "success",
  "failed",
  "cancelled",
]);

// ============ Users ============
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

// ============ Accounts（券商账户隔离：每用户每券商每模式一个账户） ============
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    broker: varchar("broker", { length: 32 }).notNull().default("longbridge"),
    mode: accountModeEnum("mode").notNull().default("paper"),
    label: varchar("label", { length: 64 }).notNull().default("default"),
    status: accountStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("accounts_user_broker_mode_label").on(t.userId, t.broker, t.mode, t.label),
    index("accounts_user_idx").on(t.userId),
  ]
);
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = typeof accounts.$inferInsert;

// ============ Account Cash（paper 模式本地现金账本；live 以券商为准） ============
export const accountCash = pgTable("account_cash", {
  accountId: integer("account_id")
    .primaryKey()
    .references(() => accounts.id),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  cash: numeric("cash", { precision: 18, scale: 2 }).notNull().default("100000"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AccountCash = typeof accountCash.$inferSelect;
export type InsertAccountCash = typeof accountCash.$inferInsert;

// ============ Watchlist ============
export const watchlist = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    name: text("name"),
    market: varchar("market", { length: 10 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("watchlist_user_symbol").on(t.userId, t.symbol)]
);
export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = typeof watchlist.$inferInsert;

// ============ Positions ============
export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    availableQuantity: numeric("available_quantity", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    avgPrice: numeric("avg_price", { precision: 18, scale: 4 }).notNull(),
    currentPrice: numeric("current_price", { precision: 18, scale: 4 }),
    marketValue: numeric("market_value", { precision: 18, scale: 2 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 18, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("positions_account_symbol").on(t.accountId, t.symbol)]
);
export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

// ============ Orders（幂等：client_order_id 每账户唯一） ============
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    /** 客户端幂等键：重复提交返回原订单，不产生重复委托 */
    clientOrderId: varchar("client_order_id", { length: 64 }).notNull(),
    /** 券商订单号（接受后回填） */
    brokerOrderId: varchar("broker_order_id", { length: 64 }),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: sideEnum("side").notNull(),
    orderType: orderTypeEnum("order_type").notNull(),
    timeInForce: timeInForceEnum("time_in_force").notNull().default("day"),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    limitPrice: numeric("limit_price", { precision: 18, scale: 4 }),
    status: orderStatusEnum("status").notNull().default("pending_accept"),
    filledQuantity: numeric("filled_quantity", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    avgFillPrice: numeric("avg_fill_price", { precision: 18, scale: 4 }),
    mode: accountModeEnum("mode").notNull().default("paper"),
    aiDecisionId: integer("ai_decision_id"),
    rejectReason: text("reject_reason"),
    riskSnapshot: jsonb("risk_snapshot"),
    submittedAt: timestamp("submitted_at"),
    lastSyncAt: timestamp("last_sync_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("orders_account_clientid").on(t.accountId, t.clientOrderId),
    uniqueIndex("orders_broker_id").on(t.brokerOrderId),
    index("orders_account_status").on(t.accountId, t.status),
    index("orders_symbol").on(t.symbol),
  ]
);
export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============ Fills（券商成交流水） ============
export const fills = pgTable(
  "fills",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    brokerTradeId: varchar("broker_trade_id", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: sideEnum("side").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    price: numeric("price", { precision: 18, scale: 4 }).notNull(),
    tradeDoneAt: timestamp("trade_done_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("fills_broker_trade_id").on(t.brokerTradeId), index("fills_order").on(t.orderId)]
);
export type Fill = typeof fills.$inferSelect;
export type InsertFill = typeof fills.$inferInsert;

// ============ Trades（按 fill 入账后的本地成交记录，用于盈亏核算/历史展示） ============
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    fillId: integer("fill_id").references(() => fills.id),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    side: sideEnum("side").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    price: numeric("price", { precision: 18, scale: 4 }).notNull(),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
    /** 卖出时按 (成交价-持仓均价)*数量 核算的已实现盈亏；买入为 0 */
    realizedPnl: numeric("realized_pnl", { precision: 18, scale: 2 }).notNull().default("0"),
    executedAt: timestamp("executed_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("trades_account_time").on(t.accountId, t.executedAt)]
);
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

// ============ AI Decisions（决策可追踪：输入来源/时间戳/模型版本/数据质量） ============
export const aiDecisions = pgTable(
  "ai_decisions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    action: actionEnum("action").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 2 }),
    compositeScore: numeric("composite_score", { precision: 5, scale: 2 }),
    fundamentalScore: numeric("fundamental_score", { precision: 5, scale: 2 }),
    sentimentScore: numeric("sentiment_score", { precision: 5, scale: 2 }),
    technicalScore: numeric("technical_score", { precision: 5, scale: 2 }),
    reasoning: text("reasoning"),
    /** 各维度输入数据及来源/时间戳（JSON），无数据时记 dataQuality 而非伪造 */
    inputs: jsonb("inputs"),
    /** ok | degraded | insufficient */
    dataQuality: varchar("data_quality", { length: 16 }).notNull().default("ok"),
    modelVersion: varchar("model_version", { length: 64 }),
    jobRunId: integer("job_run_id"),
    executed: boolean("executed").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_decisions_user_time").on(t.userId, t.createdAt), index("ai_decisions_symbol").on(t.symbol)]
);
export type AiDecision = typeof aiDecisions.$inferSelect;
export type InsertAiDecision = typeof aiDecisions.$inferInsert;

// ============ Risk Config（服务端持久化 + 版本 + kill switch） ============
export const riskConfig = pgTable("risk_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  maxPositionSize: numeric("max_position_size", { precision: 18, scale: 2 }).notNull(),
  maxTotalExposure: numeric("max_total_exposure", { precision: 18, scale: 2 }).notNull(),
  maxOrderQuantity: integer("max_order_quantity").notNull().default(1000),
  maxDailyTrades: integer("max_daily_trades").notNull().default(20),
  maxDailyLoss: numeric("max_daily_loss", { precision: 18, scale: 2 }).notNull().default("2000"),
  minAccountBalance: numeric("min_account_balance", { precision: 18, scale: 2 })
    .notNull()
    .default("5000"),
  stopLossPercent: numeric("stop_loss_percent", { precision: 5, scale: 2 }).notNull(),
  takeProfitPercent: numeric("take_profit_percent", { precision: 5, scale: 2 }).notNull(),
  enableAutoTrading: boolean("enable_auto_trading").default(false).notNull(),
  /** 账户级 kill switch */
  tradingHalted: boolean("trading_halted").default(false).notNull(),
  haltReason: text("halt_reason"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RiskConfig = typeof riskConfig.$inferSelect;
export type InsertRiskConfig = typeof riskConfig.$inferInsert;

// ============ Job Runs（调度器持久化 + 租约互斥） ============
export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    jobName: varchar("job_name", { length: 64 }).notNull(),
    status: jobStatusEnum("status").notNull().default("running"),
    leaseOwner: varchar("lease_owner", { length: 64 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    attempt: integer("attempt").notNull().default(1),
    stats: jsonb("stats"),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("job_runs_name_status").on(t.jobName, t.status)]
);
export type JobRun = typeof jobRuns.$inferSelect;
export type InsertJobRun = typeof jobRuns.$inferInsert;

// ============ Backtest Runs（回测任务：状态机 + 幂等 + 结果持久化） ============
export const backtestRunStatusEnum = pgEnum("backtest_run_status", [
  "queued",
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
]);
export const backtestRuns = pgTable(
  "backtest_runs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    /** 幂等键（user 内唯一）：相同输入+数据版本+策略版本不重复执行 */
    idempotencyKey: varchar("idempotency_key", { length: 80 }).notNull(),
    /** rerun 时的来源 run */
    parentRunId: integer("parent_run_id"),
    status: backtestRunStatusEnum("status").notNull().default("queued"),
    params: jsonb("params").notNull(),
    dataVersion: varchar("data_version", { length: 16 }),
    progressProcessed: integer("progress_processed").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    uniqueIndex("backtest_runs_user_idem").on(t.userId, t.idempotencyKey),
    index("backtest_runs_user_time").on(t.userId, t.createdAt),
  ]
);
export type BacktestRun = typeof backtestRuns.$inferSelect;
export type InsertBacktestRun = typeof backtestRuns.$inferInsert;

// ============ Audit Events（不可变审计日志，payload 已脱敏） ============
export const auditEvents = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    accountId: integer("account_id"),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }),
    entityId: varchar("entity_id", { length: 64 }),
    requestId: varchar("request_id", { length: 64 }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_user_time").on(t.userId, t.createdAt),
    index("audit_type_time").on(t.eventType, t.createdAt),
  ]
);
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;
