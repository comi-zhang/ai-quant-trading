import type { HistoryBar } from "../history/types";
import type {
  BacktestEvent,
  BacktestInput,
  BacktestResult,
  EquityPoint,
  ExecutionStatus,
  RoundTripTrade,
  SignalType,
} from "./types";
import { EXECUTION_RULE, EXECUTION_RULE_TEXT } from "./types";
import { createStrategy } from "./strategies";
import { computeMetrics } from "./metrics";

/**
 * 事件驱动回测引擎（确定性、无 look-ahead）
 *
 * 每个 bar t 的处理顺序（固定）：
 *   读取已确认历史数据（bars[0..t]）
 *   → 计算指标（仅 closes[0..t]）
 *   → 生成策略信号
 *   → 风控检查（止损/止盈可覆盖为 SELL）
 *   → 生成模拟订单意图（含 sizing/约束）
 *   → 按成交规则成交（bar t+1 开盘价 + 滑点/点差/佣金，成交量参与率限制）
 *   → 更新现金/持仓/权益
 *   → 记录事件与权益点
 *
 * 确定性：输出只依赖 (bars, input, strategy version)，重复运行结果一致。
 */

const PARTICIPATION_RATE = 0.1; // 单 bar 成交量参与率上限（部分成交规则）

function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export class BacktestCancelled extends Error {
  constructor() {
    super("backtest cancelled");
    this.name = "BacktestCancelled";
  }
}

export interface RunHooks {
  /** 每处理 progressEvery 根 bar 调用一次；返回 "cancel" 中止本次运行 */
  onProgress?: (processed: number, total: number) => "cancel" | void;
  progressEvery?: number;
}

export function runBacktest(
  bars: HistoryBar[],
  input: BacktestInput,
  dataMeta: { dataVersion: string; source: string; warnings: string[] },
  hooks: RunHooks = {}
): BacktestResult {
  if (bars.length === 0) {
    throw new Error("回测数据为空，拒绝运行（不得伪造结果）");
  }
  const progressEvery = hooks.progressEvery ?? 100;

  const strategy = createStrategy(input.strategy.name);
  const closes = bars.map((b) => b.close);

  let cash = input.initialCapital;
  let positionQty = 0;
  let avgCost = 0;
  let realizedPnl = 0;
  let totalCommission = 0;
  let totalSlippageCost = 0;
  let totalSpreadCost = 0;
  let totalTradedValue = 0;

  const events: BacktestEvent[] = [];
  const decisions: SignalType[] = [];
  const equityCurve: EquityPoint[] = [];
  const trades: RoundTripTrade[] = [];

  let eventSeq = 0;
  let peakEquity = input.initialCapital;
  let openEntry: {
    eventId: number;
    time: string;
    price: number;
    qty: number;
    barIndex: number;
    commission: number;
    costs: number;
  } | null = null;

  const sizingQty = (estPrice: number): number => {
    const budget =
      input.sizing.mode === "fixed_amount"
        ? input.sizing.amount
        : (cash + positionQty * estPrice) * input.sizing.pct;
    let qty = Math.floor(budget / estPrice);
    qty = Math.min(qty, input.maxOrderSize);
    // 单标的市值上限
    const roomValue = input.maxPositionValue - positionQty * estPrice;
    if (roomValue <= 0) return 0;
    return Math.max(0, Math.min(qty, Math.floor(roomValue / estPrice)));
  };

  const recordEquity = (t: number) => {
    const bar = bars[t];
    const positionValue = positionQty * bar.close;
    const equity = cash + positionValue;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    equityCurve.push({
      barIndex: t,
      timestamp: bar.timestamp,
      close: bar.close,
      cash: r6(cash),
      positionQty,
      positionValue: r6(positionValue),
      equity: r6(equity),
      realizedPnl: r6(realizedPnl),
      unrealizedPnl: r6(positionQty > 0 ? (bar.close - avgCost) * positionQty : 0),
      drawdownPct: r6(drawdownPct),
    });
  };

  const closeRoundTrip = (exitInfo: {
    eventId: number;
    time: string;
    price: number;
    qty: number;
    commission: number;
    costs: number;
    barIndex: number;
  }) => {
    if (!openEntry) return;
    const qty = Math.min(openEntry.qty, exitInfo.qty);
    // P&L 按现金流核算：滑点/点差已包含在成交价中，只再扣佣金（避免双重计扣）
    const pnl = (exitInfo.price - openEntry.price) * qty - openEntry.commission - exitInfo.commission;
    trades.push({
      entryEventId: openEntry.eventId,
      exitEventId: exitInfo.eventId,
      entryTime: openEntry.time,
      exitTime: exitInfo.time,
      entryPrice: r6(openEntry.price),
      exitPrice: r6(exitInfo.price),
      quantity: qty,
      pnl: r6(pnl),
      pnlPct: openEntry.price > 0 ? r6((pnl / (openEntry.price * qty)) * 100) : 0,
      holdingBars: exitInfo.barIndex - openEntry.barIndex,
      costs: r6(openEntry.costs + exitInfo.costs),
    });
    openEntry = null;
  };

  for (let t = 0; t < bars.length; t++) {
    const bar = bars[t];
    const hasPosition = positionQty > 0;

    if (hooks.onProgress && t % progressEvery === 0) {
      if (hooks.onProgress(t, bars.length) === "cancel") {
        throw new BacktestCancelled();
      }
    }

    // 1-3. 指标 + 策略信号（严格 closes[0..t]）
    const decision = strategy.decide({
      closes: closes.slice(0, t + 1),
      hasPosition,
      params: input.strategy.params,
    });
    let signal: SignalType = decision.signal;
    let signalSource = `${input.strategy.name}@${input.strategy.version} ${decision.snapshot}`;

    // 4. 风控：止损/止盈覆盖为 SELL
    if (hasPosition && avgCost > 0) {
      const pnlPct = bar.close / avgCost - 1;
      if (pnlPct <= -input.stopLossPct) {
        signal = "SELL";
        signalSource = `risk-exit stop-loss ${(pnlPct * 100).toFixed(2)}% <= -${input.stopLossPct * 100}%`;
      } else if (pnlPct >= input.takeProfitPct) {
        signal = "SELL";
        signalSource = `risk-exit take-profit ${(pnlPct * 100).toFixed(2)}% >= +${input.takeProfitPct * 100}%`;
      }
    }
    decisions.push(signal);

    if (signal === "HOLD") {
      recordEquity(t);
      continue;
    }

    // PUT：仅信号，绝不虚构期权成交
    if (signal === "PUT") {
      events.push({
        id: eventSeq++,
        barIndex: t,
        timestamp: bar.timestamp,
        bar: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
        signal,
        signalSource,
        intent: null,
        execution: null,
        cashAfter: r6(cash),
        positionQtyAfter: positionQty,
        equityAfter: r6(cash + positionQty * bar.close),
        note: "看跌信号（未执行）：当前无期权合约数据模型，不虚构 PUT 成交、溢价或收益",
      });
      recordEquity(t);
      continue;
    }

    // 5. 订单意图
    const side = signal === "BUY" ? "buy" : "sell";
    let intentQty: number;
    let skipReason: string | null = null;

    if (side === "buy") {
      if (hasPosition) {
        skipReason = "已持仓，重复买入信号去重";
      } else {
        intentQty = sizingQty(bar.close);
        if (intentQty! <= 0) skipReason = "预算/市值上限下数量为零";
      }
    } else {
      if (!hasPosition) {
        skipReason = "无可卖持仓";
      } else {
        intentQty = positionQty;
      }
    }

    // 6. 成交（bar t+1 开盘价）
    let execution: BacktestEvent["execution"] = null;
    let status: ExecutionStatus | null = null;
    const next = t + 1 < bars.length ? bars[t + 1] : null;

    if (skipReason) {
      status = side === "buy" && hasPosition ? "skipped_duplicate" : "rejected_position";
    } else if (!next) {
      status = "end_of_data";
    } else if (next.volume <= 0) {
      status = "rejected_no_liquidity";
    } else {
      const maxFill = Math.floor(next.volume * PARTICIPATION_RATE);
      let fillQty = Math.min(intentQty!, maxFill);
      if (fillQty <= 0) {
        status = "rejected_no_liquidity";
      } else {
        const dir = side === "buy" ? 1 : -1;
        const price = r6(next.open * (1 + dir * (input.slippagePct + input.spreadPct / 2)));
        const slippageCost = r6(next.open * input.slippagePct * fillQty);
        const spreadCost = r6(next.open * (input.spreadPct / 2) * fillQty);
        const commission = input.commissionPerTrade;

        if (side === "buy") {
          // 现金约束：按真实成交价收缩数量
          const affordable = Math.floor((cash - commission) / price);
          if (affordable <= 0) {
            status = "rejected_cash";
          } else {
            fillQty = Math.min(fillQty, affordable);
            const cost = price * fillQty + commission;
            cash -= cost;
            totalCommission += commission;
            totalSlippageCost += slippageCost;
            totalSpreadCost += spreadCost;
            totalTradedValue += price * fillQty;
            avgCost = (avgCost * positionQty + price * fillQty) / (positionQty + fillQty);
            positionQty += fillQty;
            status = fillQty < intentQty! ? "partial_filled" : "filled";
            execution = {
              side,
              quantity: fillQty,
              price,
              timestamp: next.timestamp,
              commission,
              slippageCost,
              spreadCost,
              status,
              realizedPnl: 0,
            };
            openEntry = {
              eventId: eventSeq,
              time: next.timestamp,
              price,
              qty: fillQty,
              barIndex: t + 1,
              commission,
              costs: commission + slippageCost + spreadCost,
            };
          }
        } else {
          fillQty = Math.min(fillQty, positionQty);
          const proceeds = price * fillQty - commission;
          cash += proceeds;
          totalCommission += commission;
          totalSlippageCost += slippageCost;
          totalSpreadCost += spreadCost;
          totalTradedValue += price * fillQty;
          const pnl = (price - avgCost) * fillQty - commission;
          realizedPnl += pnl;
          positionQty -= fillQty;
          if (positionQty === 0) avgCost = 0;
          status = fillQty < intentQty! ? "partial_filled" : "filled";
          execution = {
            side,
            quantity: fillQty,
            price,
            timestamp: next.timestamp,
            commission,
            slippageCost,
            spreadCost,
            status,
            realizedPnl: r6(pnl),
          };
          closeRoundTrip({
            eventId: eventSeq,
            time: next.timestamp,
            price,
            qty: fillQty,
            commission,
            costs: commission + slippageCost + spreadCost,
            barIndex: t + 1,
          });
        }
      }
    }

    if (!execution && status) {
      execution = null;
    }

    events.push({
      id: eventSeq++,
      barIndex: t,
      timestamp: bar.timestamp,
      bar: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
      signal,
      signalSource,
      intent: skipReason
        ? null
        : { side, quantity: intentQty!, reason: signalSource },
      execution: execution ?? (status
        ? {
            side,
            quantity: 0,
            price: 0,
            timestamp: next?.timestamp ?? bar.timestamp,
            commission: 0,
            slippageCost: 0,
            spreadCost: 0,
            status,
            realizedPnl: 0,
          }
        : null),
      cashAfter: r6(cash),
      positionQtyAfter: positionQty,
      equityAfter: r6(cash + positionQty * bar.close),
      ...(skipReason ? { note: skipReason } : {}),
    });

    recordEquity(t);
  }

  // 7. 回测结束：强制平仓（按最后收盘价 + 成本）
  if (positionQty > 0) {
    const last = bars[bars.length - 1];
    const price = r6(last.close * (1 - input.slippagePct - input.spreadPct / 2));
    const commission = input.commissionPerTrade;
    const slippageCost = r6(last.close * input.slippagePct * positionQty);
    const spreadCost = r6(last.close * (input.spreadPct / 2) * positionQty);
    const pnl = (price - avgCost) * positionQty - commission;
    cash += price * positionQty - commission;
    realizedPnl += pnl;
    totalCommission += commission;
    totalSlippageCost += slippageCost;
    totalSpreadCost += spreadCost;
    totalTradedValue += price * positionQty;
    events.push({
      id: eventSeq++,
      barIndex: bars.length - 1,
      timestamp: last.timestamp,
      bar: { open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume },
      signal: "SELL",
      signalSource: "backtest-end force-close",
      intent: { side: "sell", quantity: positionQty, reason: "回测结束强制平仓" },
      execution: {
        side: "sell",
        quantity: positionQty,
        price,
        timestamp: last.timestamp,
        commission,
        slippageCost,
        spreadCost,
        status: "filled",
        realizedPnl: r6(pnl),
      },
      cashAfter: r6(cash),
      positionQtyAfter: 0,
      equityAfter: r6(cash),
      note: "回测结束强制平仓（按最后收盘价）",
    });
    closeRoundTrip({
      eventId: eventSeq - 1,
      time: last.timestamp,
      price,
      qty: positionQty,
      commission,
      costs: commission + slippageCost + spreadCost,
      barIndex: bars.length - 1,
    });
    positionQty = 0;
    // 更新最后权益点
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint) {
      lastPoint.cash = r6(cash);
      lastPoint.positionQty = 0;
      lastPoint.positionValue = 0;
      lastPoint.equity = r6(cash);
      lastPoint.realizedPnl = r6(realizedPnl);
      lastPoint.unrealizedPnl = 0;
    }
  }

  const finalEquity = cash;
  const metrics = computeMetrics({
    initialCapital: input.initialCapital,
    finalEquity,
    equityCurve,
    trades,
    bars,
    totalCommission: r6(totalCommission),
    totalSlippageCost: r6(totalSlippageCost),
    totalSpreadCost: r6(totalSpreadCost),
    totalTradedValue: r6(totalTradedValue),
  });

  return {
    meta: {
      input,
      dataVersion: dataMeta.dataVersion,
      dataSource: dataMeta.source,
      executionRule: EXECUTION_RULE,
      executionRuleText: EXECUTION_RULE_TEXT,
      strategy: {
        name: input.strategy.name,
        version: input.strategy.version,
        params: input.strategy.params,
      },
      createdAt: new Date().toISOString(),
      barCount: bars.length,
      warnings: dataMeta.warnings,
    },
    bars,
    decisions,
    events,
    trades,
    equityCurve,
    metrics,
  };
}
