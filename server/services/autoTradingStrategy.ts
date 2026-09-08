import { eq } from "drizzle-orm";
import { aiDecisions } from "../../drizzle/schema";
import { getDb, insertAiDecision, listAiDecisions, type Db } from "../db";
import { ENV } from "../_core/env";
import { getDefaultGateway, type LongbridgeGateway } from "./longbridge/gateway";
import { normalizeSymbol } from "./longbridge/contract";
import { calculateTechnicalScore } from "./indicators";
import { analyzeWithGemini } from "./geminiDecisionEngine";
import { getOrderService, type OrderService } from "./orderService";

/**
 * 自动交易策略（重写）
 *
 * 数据链：行情/K线（gateway，带来源时间戳）→ 技术评分（真实计算）
 *        → [可选] 基本面/舆情（未配置时标记 dataQuality，不伪造 50 分）
 *        → AI/规则决策 → 持久化 ai_decisions → orderService 执行（含风控/幂等/审计）
 *
 * 禁止事项：固定 50 分、固定目标价、假新闻、空持仓 Map、dailyLoss=0。
 */

export type DataQuality = "ok" | "degraded" | "insufficient";

export interface AnalysisResult {
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  compositeScore: number | null;
  scores: { fundamental: number | null; sentiment: number | null; technical: number | null };
  referencePrice: number | null;
  reasoning: string;
  dataQuality: DataQuality;
  inputs: Record<string, unknown>;
}

export interface StrategyExecutionResult {
  symbol: string;
  decisionId: number | null;
  action: "buy" | "sell" | "hold";
  executed: boolean;
  orderResult?: unknown;
  message: string;
  dataQuality: DataQuality;
}

const TECH_WEIGHT = 0.2;
const FUND_WEIGHT = 0.4;
const SENT_WEIGHT = 0.4;

export class AutoTradingStrategy {
  constructor(
    private readonly gateway: LongbridgeGateway = getDefaultGateway(),
    private readonly orderService: OrderService | null = null,
    private readonly db: Db | null = null
  ) {}

  /** 只读分析：不产生任何订单 */
  async analyze(symbolInput: string): Promise<AnalysisResult> {
    const symbol = normalizeSymbol(symbolInput);
    const inputs: Record<string, unknown> = { sources: [] as unknown[] };
    const sources = inputs.sources as unknown[];

    // 1. 行情
    let referencePrice: number | null = null;
    try {
      const quote = await this.gateway.getQuote(symbol);
      referencePrice = quote.lastDone;
      sources.push({ type: "quote", symbol, at: new Date().toISOString(), lastDone: quote.lastDone });
    } catch (err) {
      sources.push({ type: "quote", error: (err as Error).message, at: new Date().toISOString() });
    }

    // 2. 技术评分（真实 K 线计算）
    let technical: number | null = null;
    try {
      const candles = await this.gateway.getCandlesticks(symbol, "day", 120);
      const closes = candles.map((c) => c.close).filter((v): v is number => v !== null);
      technical = calculateTechnicalScore(closes);
      sources.push({ type: "candlesticks", count: closes.length, at: new Date().toISOString() });
    } catch (err) {
      sources.push({ type: "candlesticks", error: (err as Error).message, at: new Date().toISOString() });
    }

    // 3. 基本面/舆情：未配置数据源时保持 null + degraded（绝不返回固定 50）
    const fundamental: number | null = null;
    const sentiment: number | null = null;
    if (!ENV.alphaVantageApiKey) {
      sources.push({ type: "fundamental", skipped: "ALPHA_VANTAGE_API_KEY 未配置", at: new Date().toISOString() });
    }
    if (!ENV.newsApiKey) {
      sources.push({ type: "sentiment", skipped: "NEWS_API_KEY 未配置", at: new Date().toISOString() });
    }

    // 4. 综合评分（按可用维度重新归一化权重）
    let composite: number | null = null;
    {
      let sum = 0;
      let weight = 0;
      if (fundamental !== null) { sum += fundamental * FUND_WEIGHT; weight += FUND_WEIGHT; }
      if (sentiment !== null) { sum += sentiment * SENT_WEIGHT; weight += SENT_WEIGHT; }
      if (technical !== null) { sum += technical * TECH_WEIGHT; weight += TECH_WEIGHT; }
      if (weight > 0) composite = Math.round((sum / weight) * 100) / 100;
    }

    const dataQuality: DataQuality =
      referencePrice === null || technical === null
        ? "insufficient"
        : fundamental === null || sentiment === null
          ? "degraded"
          : "ok";

    // 5. 决策：Gemini 可用时走 LLM，否则用确定性规则；数据不足一律 hold
    let action: "buy" | "sell" | "hold" = "hold";
    let confidence = 0;
    let reasoning = "";

    if (dataQuality === "insufficient") {
      reasoning = "数据不足（缺少行情或技术指标），不产生交易信号";
    } else if (ENV.geminiApiUrl && ENV.geminiApiKey) {
      const decision = await analyzeWithGemini({
        symbol,
        fundamentalScore: fundamental ?? 0,
        sentimentScore: sentiment ?? 0,
        technicalScore: technical ?? 0,
        currentPrice: referencePrice ?? 0,
        targetPrice: referencePrice ?? 0,
        newsHeadlines: [],
      });
      if (decision) {
        action = decision.action;
        confidence = decision.confidence;
        reasoning = decision.reasoning;
      } else {
        reasoning = "LLM 分析失败，保持持有";
      }
    } else {
      // 确定性规则（可复现）：composite >= 65 buy, <= 35 sell
      if (composite !== null && composite >= 65) {
        action = "buy";
        confidence = Math.min(90, Math.round(composite));
      } else if (composite !== null && composite <= 35) {
        action = "sell";
        confidence = Math.min(90, Math.round(100 - composite));
      } else {
        action = "hold";
        confidence = 50;
      }
      reasoning = `规则决策: composite=${composite?.toFixed(1) ?? "N/A"}（技术=${technical}，其余维度缺失按可用权重归一）`;
    }

    return {
      symbol,
      action,
      confidence,
      compositeScore: composite,
      scores: { fundamental, sentiment, technical },
      referencePrice,
      reasoning,
      dataQuality,
      inputs,
    };
  }

  /** 持久化决策记录 */
  async persistDecision(userId: number, analysis: AnalysisResult, jobRunId?: number) {
    if (this.db) {
      const rows = await this.db
        .insert(aiDecisions)
        .values(this.toDecisionRow(userId, analysis, jobRunId))
        .returning();
      return rows[0];
    }
    return insertAiDecision(this.toDecisionRow(userId, analysis, jobRunId));
  }

  private toDecisionRow(userId: number, analysis: AnalysisResult, jobRunId?: number) {
    return {
      userId,
      symbol: analysis.symbol,
      action: analysis.action,
      confidence: String(analysis.confidence),
      compositeScore: analysis.compositeScore !== null ? String(analysis.compositeScore) : null,
      fundamentalScore: analysis.scores.fundamental !== null ? String(analysis.scores.fundamental) : null,
      sentimentScore: analysis.scores.sentiment !== null ? String(analysis.scores.sentiment) : null,
      technicalScore: analysis.scores.technical !== null ? String(analysis.scores.technical) : null,
      reasoning: analysis.reasoning,
      inputs: analysis.inputs,
      dataQuality: analysis.dataQuality,
      modelVersion: ENV.geminiApiKey ? "gemini" : "rules-v1",
      jobRunId: jobRunId ?? null,
    };
  }

  /**
   * 分析 → 持久化 → （可选）执行。
   * execute=false 时为只读分析（dry-run）。
   */
  async runForSymbol(
    userId: number,
    symbol: string,
    opts: { execute?: boolean; jobRunId?: number } = {}
  ): Promise<StrategyExecutionResult> {
    const analysis = await this.analyze(symbol);
    const persisted = await this.persistDecision(userId, analysis, opts.jobRunId);

    if (!opts.execute) {
      return {
        symbol: analysis.symbol,
        decisionId: persisted?.id ?? null,
        action: analysis.action,
        executed: false,
        message: "只读分析（dry-run），未执行",
        dataQuality: analysis.dataQuality,
      };
    }

    if (analysis.action === "hold") {
      return {
        symbol: analysis.symbol,
        decisionId: persisted?.id ?? null,
        action: "hold",
        executed: false,
        message: "决策为持有，不执行",
        dataQuality: analysis.dataQuality,
      };
    }

    if (analysis.dataQuality === "insufficient" || analysis.referencePrice === null) {
      return {
        symbol: analysis.symbol,
        decisionId: persisted?.id ?? null,
        action: analysis.action,
        executed: false,
        message: "数据质量不足，拒绝执行（fail closed）",
        dataQuality: analysis.dataQuality,
      };
    }

    const service = this.orderService ?? (await getOrderService());
    if (!service) {
      return {
        symbol: analysis.symbol,
        decisionId: persisted?.id ?? null,
        action: analysis.action,
        executed: false,
        message: "交易服务不可用（数据库未连接）",
        dataQuality: analysis.dataQuality,
      };
    }

    // 仓位大小：由风控定界，策略只给保守意向（账户现金 5%）
    const overview = await service.getAccountOverview(userId);
    const budget = overview.cash * 0.05;
    const quantity = Math.floor(budget / analysis.referencePrice);
    if (quantity <= 0 && analysis.action === "buy") {
      return {
        symbol: analysis.symbol,
        decisionId: persisted?.id ?? null,
        action: analysis.action,
        executed: false,
        message: "预算不足一手，放弃执行",
        dataQuality: analysis.dataQuality,
      };
    }

    const result = await service.submitOrder({
      userId,
      symbol: analysis.symbol,
      side: analysis.action,
      orderType: "market",
      quantity: analysis.action === "sell" ? Math.max(1, quantity) : quantity,
      timeInForce: "day",
      aiDecisionId: persisted?.id,
      automated: true,
    });

    if (persisted && result.status !== "rejected") {
      const db = this.db ?? (await getDb());
      if (db) {
        await db.update(aiDecisions).set({ executed: true }).where(eq(aiDecisions.id, persisted.id));
      }
    }

    return {
      symbol: analysis.symbol,
      decisionId: persisted?.id ?? null,
      action: analysis.action,
      executed: result.status === "filled" || result.status === "accepted",
      orderResult: result,
      message: result.message,
      dataQuality: analysis.dataQuality,
    };
  }
}

/** 最近决策（Dashboard 使用） */
export async function getRecentDecisions(userId: number, limit = 10, symbol?: string) {
  return listAiDecisions(userId, { limit, symbol });
}
