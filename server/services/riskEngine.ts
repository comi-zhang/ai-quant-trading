import type { RiskConfig } from "../../drizzle/schema";

/**
 * 风控引擎（fail-closed）
 *
 * 设计原则：
 * - 输入是一个一致性快照（同一时刻的现金/持仓/当日统计），不在检查中再取数；
 * - 任何数据缺失/非法（null、NaN、负数现金、过期价格）一律拒绝并说明原因；
 * - 每个规则独立返回结果，最终取所有拒绝项；绝不把未知状态当成通过。
 */

export interface AccountSnapshot {
  /** 可用现金（paper=本地账本，live=券商快照） */
  availableCash: number | null;
  /** 持仓（含可卖数量） */
  positions: {
    symbol: string;
    quantity: number;
    availableQuantity: number;
    marketValue: number | null;
    avgPrice: number | null;
  }[];
  /** 当日已提交订单数 */
  todayOrderCount: number;
  /** 当日已实现亏损（正数表示亏损金额；无数据传 0，不得传 null 冒充未知） */
  todayRealizedLoss: number;
  /** 当前参考价（下单标的） */
  referencePrice: number | null;
  /** 参考价时间戳（过期判定） */
  referencePriceAt: Date | null;
  /** 快照时间 */
  snapshotAt: Date;
}

export interface RiskDecision {
  allowed: boolean;
  violations: string[];
  warnings: string[];
}

export interface OrderIntent {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  limitPrice?: number;
}

const MAX_PRICE_AGE_MS = 15 * 60 * 1000; // 参考价超过 15 分钟视为过期

function finitePositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function evaluateOrderRisk(
  intent: OrderIntent,
  snapshot: AccountSnapshot,
  config: RiskConfig,
  opts: { tradingHalted?: boolean; autoTrading?: boolean; now?: Date } = {}
): RiskDecision {
  const violations: string[] = [];
  const warnings: string[] = [];
  const now = opts.now ?? new Date();

  // 0. kill switch / 全局闸门
  if (opts.tradingHalted || config.tradingHalted) {
    violations.push("交易已被 kill switch 暂停");
    return { allowed: false, violations, warnings };
  }

  // 1. 输入合法性（0、负数、NaN、超大量）
  if (!finitePositive(intent.quantity) || !Number.isInteger(intent.quantity)) {
    violations.push(`非法数量: ${intent.quantity}`);
  }
  if (intent.quantity > 1_000_000) {
    violations.push(`数量超过绝对上限: ${intent.quantity}`);
  }
  if (intent.orderType === "limit" && !finitePositive(intent.limitPrice)) {
    violations.push("限价单必须提供正数限价");
  }
  if (!intent.symbol || typeof intent.symbol !== "string") {
    violations.push("非法标的");
  }
  if (violations.length > 0) return { allowed: false, violations, warnings };

  // 2. 参考价有效性与新鲜度
  if (!finitePositive(snapshot.referencePrice)) {
    violations.push("缺少有效参考价，无法评估风险（fail closed）");
  } else if (snapshot.referencePriceAt && now.getTime() - snapshot.referencePriceAt.getTime() > MAX_PRICE_AGE_MS) {
    violations.push("参考价已过期，无法评估风险（fail closed）");
  }
  const price = snapshot.referencePrice ?? 0;
  const effectivePrice = intent.orderType === "limit" && intent.limitPrice ? intent.limitPrice : price;
  const orderValue = finitePositive(effectivePrice) ? intent.quantity * effectivePrice : null;

  // 3. 现金充足性（买入）
  if (intent.side === "buy") {
    if (!finitePositive(snapshot.availableCash) && snapshot.availableCash !== 0) {
      violations.push("可用现金未知，拒绝下单（fail closed）");
    } else if (orderValue !== null) {
      const cash = snapshot.availableCash ?? 0;
      if (orderValue > cash) {
        violations.push(`现金不足: 需要 ${orderValue.toFixed(2)}，可用 ${cash.toFixed(2)}`);
      } else {
        const minBalance = Number(config.minAccountBalance);
        if (Number.isFinite(minBalance) && cash - orderValue < minBalance) {
          violations.push(`低于最小保留余额: 剩余 ${(cash - orderValue).toFixed(2)}，要求 ${minBalance.toFixed(2)}`);
        }
      }
    }
  }

  // 4. 卖出可用数量
  if (intent.side === "sell") {
    const pos = snapshot.positions.find((p) => p.symbol === intent.symbol);
    if (!pos || !Number.isFinite(pos.availableQuantity)) {
      violations.push(`无 ${intent.symbol} 可卖持仓（fail closed）`);
    } else if (intent.quantity > pos.availableQuantity) {
      violations.push(`可卖数量不足: 请求 ${intent.quantity}，可用 ${pos.availableQuantity}`);
    }
  }

  // 5. 单笔数量上限
  if (intent.quantity > config.maxOrderQuantity) {
    violations.push(`单笔数量超限: ${intent.quantity} > ${config.maxOrderQuantity}`);
  }

  // 6. 单标的暴露与总暴露（基于市值快照；市值缺失的持仓按未知处理→拒绝）
  if (intent.side === "buy" && orderValue !== null) {
    let totalExposure = 0;
    let unknownExposure = false;
    let symbolExposure = 0;
    for (const p of snapshot.positions) {
      if (p.marketValue === null || !Number.isFinite(p.marketValue)) {
        if (p.quantity > 0) unknownExposure = true;
        continue;
      }
      totalExposure += p.marketValue;
      if (p.symbol === intent.symbol) symbolExposure += p.marketValue;
    }
    if (unknownExposure) {
      violations.push("存在市值未知的持仓，无法计算暴露（fail closed）");
    } else {
      if (symbolExposure + orderValue > Number(config.maxPositionSize)) {
        violations.push(
          `单标的暴露超限: ${(symbolExposure + orderValue).toFixed(2)} > ${Number(config.maxPositionSize).toFixed(2)}`
        );
      }
      if (totalExposure + orderValue > Number(config.maxTotalExposure)) {
        violations.push(
          `总暴露超限: ${(totalExposure + orderValue).toFixed(2)} > ${Number(config.maxTotalExposure).toFixed(2)}`
        );
      }
    }
  }

  // 7. 日交易次数
  if (snapshot.todayOrderCount >= config.maxDailyTrades) {
    violations.push(`当日交易次数已达上限: ${snapshot.todayOrderCount}/${config.maxDailyTrades}`);
  }

  // 8. 日亏损熔断
  const maxDailyLoss = Number(config.maxDailyLoss);
  if (Number.isFinite(maxDailyLoss) && snapshot.todayRealizedLoss >= maxDailyLoss) {
    violations.push(`当日亏损熔断: 已亏 ${snapshot.todayRealizedLoss.toFixed(2)}，上限 ${maxDailyLoss.toFixed(2)}`);
  }

  return { allowed: violations.length === 0, violations, warnings };
}

/**
 * 计算当日已实现亏损（正数=亏损）。
 * 简化核算法：按 FIFO 不够精确时，用 卖出成交额 - 卖出数量对应成本 估计；
 * 这里输入为逐笔 (side, quantity, price, costAtTrade) 记录。
 */
export function computeRealizedLoss(
  trades: { side: "buy" | "sell"; quantity: number; price: number; costBasis: number | null }[]
): number {
  let realized = 0;
  for (const t of trades) {
    if (t.side !== "sell") continue;
    if (t.costBasis === null) continue; // 成本未知不计入（由调用方决定是否更保守）
    realized += (t.price - t.costBasis) * t.quantity;
  }
  return realized < 0 ? -realized : 0;
}
