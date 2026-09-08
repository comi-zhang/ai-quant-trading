import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";

/**
 * 交易模式守卫 —— 系统安全的最后一道防线。
 *
 * 规则：
 * - 默认 TRADING_MODE=paper，LIVE_TRADING_ENABLED=false；
 * - 任何会产生真实资金影响的操作（真实下单/撤单）都必须经过 assertLiveTradingAllowed()；
 * - live 需要同时满足 TRADING_MODE=live 且 LIVE_TRADING_ENABLED=true（双开关）；
 * - kill switch（全局/账户级）优先于一切。
 *
 * 注意：本模块不做网络调用，纯本地判定，可单测。
 */

export class LiveTradingBlockedError extends Error {
  readonly code = "LIVE_TRADING_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "LiveTradingBlockedError";
  }
}

/** 当前是否为 live 模式（双开关同时打开） */
export function isLiveMode(): boolean {
  return ENV.tradingMode === "live" && ENV.liveTradingEnabled;
}

/**
 * 断言允许真实（live）交易。默认拒绝。
 * 在任何调用券商真实下单/撤单接口之前必须调用。
 */
export function assertLiveTradingAllowed(context?: string): void {
  if (!isLiveMode()) {
    throw new LiveTradingBlockedError(
      `真实交易已禁用${context ? `（${context}）` : ""}：` +
        `当前 TRADING_MODE=${ENV.tradingMode}, LIVE_TRADING_ENABLED=${ENV.liveTradingEnabled}。` +
        `请使用 paper 模式。`
    );
  }
}

/** tRPC 版本：将守卫错误转为稳定的客户端错误码 */
export function assertLiveTradingAllowedTrpc(context?: string): void {
  try {
    assertLiveTradingAllowed(context);
  } catch (err) {
    if (err instanceof LiveTradingBlockedError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
    }
    throw err;
  }
}

/** 是否允许自动交易（独立开关，且自动交易在 live 下需要 live 双开关） */
export function isAutoTradingEnabled(): boolean {
  return ENV.autoTradingEnabled;
}
