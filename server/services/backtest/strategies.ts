import type { SignalType, StrategyName } from "./types";
import { calculateSMA, calculateRSI } from "../indicators";

/**
 * 确定性策略集。
 *
 * 硬性约束（防 look-ahead）：
 * decide() 只能读取 closes[0..t]（含 t），框架通过只传入切片保证。
 *
 * 信号语义：
 * - BUY：开多/买入（无持仓时有效）
 * - SELL：平多/卖出（有持仓时有效）
 * - PUT：看跌信号（无持仓时的看空表达）。系统无期权数据模型，
 *   PUT 仅记录为“看跌信号（未执行）”，绝不虚构期权成交/权利金/收益。
 * - HOLD：无操作
 */

export interface StrategyContext {
  /** closes[0..t]（含当前 bar） */
  closes: number[];
  hasPosition: boolean;
  params: Record<string, number>;
}

export interface StrategyDecision {
  signal: SignalType;
  /** 指标快照（用于事件 signalSource 与前端展示） */
  snapshot: string;
}

export interface Strategy {
  readonly name: StrategyName;
  decide(ctx: StrategyContext): StrategyDecision;
}

export class MaCrossStrategy implements Strategy {
  readonly name = "ma-cross" as const;
  decide({ closes, hasPosition, params }: StrategyContext): StrategyDecision {
    const fastLen = Math.max(2, Math.floor(params.fast ?? 5));
    const slowLen = Math.max(fastLen + 1, Math.floor(params.slow ?? 20));
    if (closes.length < slowLen + 1) {
      return { signal: "HOLD", snapshot: `warmup(${closes.length}/${slowLen + 1})` };
    }
    const fast = calculateSMA(closes, fastLen);
    const slow = calculateSMA(closes, slowLen);
    const fNow = fast[fast.length - 1];
    const sNow = slow[slow.length - 1];
    const fPrev = fast[fast.length - 2];
    const sPrev = slow[slow.length - 2];
    const snapshot = `SMA${fastLen}=${fNow.toFixed(2)} SMA${slowLen}=${sNow.toFixed(2)}`;

    const crossUp = fPrev <= sPrev && fNow > sNow;
    const crossDown = fPrev >= sPrev && fNow < sNow;

    if (crossUp) {
      return hasPosition
        ? { signal: "HOLD", snapshot: `${snapshot} | 已持仓，金叉忽略` }
        : { signal: "BUY", snapshot: `${snapshot} | 金叉` };
    }
    if (crossDown) {
      return hasPosition
        ? { signal: "SELL", snapshot: `${snapshot} | 死叉` }
        : { signal: "PUT", snapshot: `${snapshot} | 死叉（无持仓→看跌信号）` };
    }
    return { signal: "HOLD", snapshot };
  }
}

export class RsiReversionStrategy implements Strategy {
  readonly name = "rsi-reversion" as const;
  decide({ closes, hasPosition, params }: StrategyContext): StrategyDecision {
    const period = Math.max(2, Math.floor(params.period ?? 14));
    const oversold = params.oversold ?? 30;
    const overbought = params.overbought ?? 70;
    const rsi = calculateRSI(closes, period);
    if (rsi === null) {
      return { signal: "HOLD", snapshot: `warmup(${closes.length}/${period + 1})` };
    }
    const snapshot = `RSI${period}=${rsi.toFixed(1)}`;
    if (rsi < oversold) {
      return hasPosition
        ? { signal: "HOLD", snapshot: `${snapshot} | 超卖但已持仓` }
        : { signal: "BUY", snapshot: `${snapshot} | 超卖反弹` };
    }
    if (rsi > overbought) {
      return hasPosition
        ? { signal: "SELL", snapshot: `${snapshot} | 超买回落` }
        : { signal: "PUT", snapshot: `${snapshot} | 超买（无持仓→看跌信号）` };
    }
    return { signal: "HOLD", snapshot };
  }
}

export function createStrategy(name: StrategyName): Strategy {
  switch (name) {
    case "ma-cross":
      return new MaCrossStrategy();
    case "rsi-reversion":
      return new RsiReversionStrategy();
  }
}
