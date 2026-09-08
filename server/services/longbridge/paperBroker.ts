import { randomUUID } from "crypto";
import { normalizeSymbol } from "./contract";
import type { SubmitOrderInput } from "./gateway";

/**
 * Paper Broker —— 本地模拟券商。
 * 绝不发起任何网络请求；仅用于 paper 模式下的完整交易闭环
 * （风控 → 幂等 → 持久化 → 状态机 → 成交入账）。
 *
 * 成交模拟规则（确定、可测试）：
 * - 市价单：以 referencePrice 立即全部成交；
 * - 限价买单：referencePrice <= limitPrice 时立即成交，否则保持 accepted；
 * - 限价卖单：referencePrice >= limitPrice 时立即成交，否则保持 accepted；
 * - 无参考价：保持 accepted，等待 reconcile 时再次评估。
 */

export interface PaperExecutionResult {
  brokerOrderId: string;
  status: "accepted" | "filled";
  filledQuantity: number;
  avgFillPrice: number | null;
  fills: { tradeId: string; quantity: number; price: number; tradeDoneAt: Date }[];
}

export function executePaperOrder(
  input: SubmitOrderInput,
  referencePrice: number | null,
  now: Date = new Date()
): PaperExecutionResult {
  const symbol = normalizeSymbol(input.symbol);
  const brokerOrderId = `PAPER-${randomUUID()}`;

  if (input.quantity <= 0 || !Number.isFinite(input.quantity)) {
    throw new Error(`非法数量: ${input.quantity}`);
  }

  const canFill = (price: number): boolean => {
    if (input.orderType === "market") return true;
    const limit = input.limitPrice;
    if (limit === undefined) return false;
    return input.side === "buy" ? price <= limit : price >= limit;
  };

  if (referencePrice === null || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return { brokerOrderId, status: "accepted", filledQuantity: 0, avgFillPrice: null, fills: [] };
  }

  if (!canFill(referencePrice)) {
    return { brokerOrderId, status: "accepted", filledQuantity: 0, avgFillPrice: null, fills: [] };
  }

  return {
    brokerOrderId,
    status: "filled",
    filledQuantity: input.quantity,
    avgFillPrice: referencePrice,
    fills: [
      {
        tradeId: `PAPERFILL-${randomUUID()}`,
        quantity: input.quantity,
        price: referencePrice,
        tradeDoneAt: now,
      },
    ],
  };
}

/** paper 撤单：accepted/cancelling → cancelled（本地状态机由 orderService 驱动） */
export function canCancelPaperStatus(status: string): boolean {
  return status === "accepted" || status === "partial_filled" || status === "pending_accept";
}
