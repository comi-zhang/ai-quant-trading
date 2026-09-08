import { z } from "zod";
import type { HistoryBar, Period } from "../history/types";

/**
 * 回测引擎类型定义
 *
 * 成交规则（固定，UI/报告/测试三方一致）：
 *   信号在 bar t 收盘后产生，订单在 bar t+1 开盘价成交
 *   （滑点与点差在此基础上对不利方向调整）。
 *   最后一根 bar 的信号无法成交（end_of_data）；
 *   回测结束时未平仓头寸按最后收盘价强制平仓。
 */

export const signalTypeSchema = z.enum(["BUY", "SELL", "PUT", "HOLD"]);
export type SignalType = z.infer<typeof signalTypeSchema>;

export const EXECUTION_RULE = "next_bar_open" as const;
export const EXECUTION_RULE_TEXT = "信号 bar 收盘后决策，下一 bar 开盘价成交（含滑点/点差/佣金）";

export const strategyNameSchema = z.enum(["ma-cross", "rsi-reversion"]);
export type StrategyName = z.infer<typeof strategyNameSchema>;

export const backtestInputSchema = z
  .object({
    symbol: z.string().min(1).max(20),
    period: z.enum(["day", "week", "month"]).default("day"),
    startTime: z.string(),
    endTime: z.string(),
    source: z.enum(["longbridge", "fixture"]).optional(),
    initialCapital: z.number().positive().min(100).max(10_000_000),
    sizing: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("fixed_amount"), amount: z.number().positive().max(10_000_000) }),
      z.object({ mode: z.literal("capital_pct"), pct: z.number().positive().max(1) }),
    ]),
    maxPositionValue: z.number().positive().max(100_000_000),
    maxOrderSize: z.number().int().positive().max(1_000_000),
    commissionPerTrade: z.number().min(0).max(10_000),
    slippagePct: z.number().min(0).max(0.1),
    spreadPct: z.number().min(0).max(0.1),
    stopLossPct: z.number().min(0).max(1),
    takeProfitPct: z.number().min(0).max(100),
    strategy: z.object({
      name: strategyNameSchema,
      version: z.string().min(1).max(32),
      params: z.record(z.string(), z.number()).default({}),
    }),
  })
  .refine((v) => new Date(v.startTime).getTime() < new Date(v.endTime).getTime(), {
    message: "startTime 必须早于 endTime",
  });
export type BacktestInput = z.infer<typeof backtestInputSchema>;

// ---------- 事件 ----------
export type ExecutionStatus =
  | "filled" // 全部成交
  | "partial_filled" // 部分成交（成交量参与率限制）
  | "rejected_cash" // 现金不足
  | "rejected_position" // 无可卖持仓
  | "rejected_no_liquidity" // 零成交量 bar
  | "skipped_duplicate" // 重复信号（已持仓再 BUY 等）
  | "signal_only" // 仅信号（PUT：无期权模型，不执行）
  | "end_of_data"; // 最后一根 bar，无下一 bar 可成交

export interface BacktestEvent {
  /** 唯一事件 ID（run 内递增） */
  id: number;
  /** 信号产生所在 bar */
  barIndex: number;
  timestamp: string;
  bar: { open: number; high: number; low: number; close: number; volume: number };
  signal: SignalType;
  /** 信号来源：策略名+关键指标快照 */
  signalSource: string;
  intent: { side: "buy" | "sell"; quantity: number; reason: string } | null;
  execution: {
    side: "buy" | "sell";
    quantity: number;
    price: number;
    timestamp: string;
    commission: number;
    slippageCost: number;
    spreadCost: number;
    status: ExecutionStatus;
    /** 本笔已实现 P&L（卖出时） */
    realizedPnl: number;
  } | null;
  cashAfter: number;
  positionQtyAfter: number;
  equityAfter: number;
  note?: string;
}

export interface RoundTripTrade {
  entryEventId: number;
  exitEventId: number;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  holdingBars: number;
  costs: number;
}

export interface EquityPoint {
  barIndex: number;
  timestamp: string;
  close: number;
  cash: number;
  positionQty: number;
  positionValue: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  drawdownPct: number;
}

export interface BacktestMetrics {
  netProfit: number;
  returnPct: number;
  annualizedReturnPct: number | null;
  finalEquity: number;
  maxDrawdownPct: number;
  maxDrawdownInterval: { start: string; end: string } | null;
  sharpe: number | null;
  sortino: number | null;
  winRate: number | null;
  totalTrades: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  totalCommission: number;
  totalSlippageCost: number;
  totalSpreadCost: number;
  turnoverPct: number;
  avgHoldingBars: number | null;
  maxConsecutiveLosses: number;
  benchmarkReturnPct: number;
  benchmarkFinalEquity: number;
}

export interface BacktestResult {
  meta: {
    input: BacktestInput;
    dataVersion: string;
    dataSource: string;
    executionRule: typeof EXECUTION_RULE;
    executionRuleText: string;
    strategy: { name: StrategyName; version: string; params: Record<string, number> };
    createdAt: string;
    barCount: number;
    warnings: string[];
  };
  bars: HistoryBar[];
  /** 每 bar 决策（与 bars 对齐，用于回放） */
  decisions: SignalType[];
  events: BacktestEvent[];
  trades: RoundTripTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
}
