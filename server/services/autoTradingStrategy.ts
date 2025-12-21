import { getDb } from "../db";
import { getRealTimeQuote, getRealTimeQuotes, getAccountAssets } from "./longbridgeRealtime";
import { analyzeWithGemini } from "./geminiDecisionEngine";
import { executeAutoTrade, submitMarketOrder } from "./longbridgeTrading";
import { validateOrderRisk } from "./riskManagement";

/**
 * 自动交易策略执行服务
 * 定期执行AI决策并自动下单
 */

interface TradeSignal {
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  targetPrice: number;
  reasoning: string;
  scores: {
    fundamental: number;
    sentiment: number;
    technical: number;
    composite: number;
  };
}

interface AutoTradeResult {
  symbol: string;
  signal: TradeSignal;
  executed: boolean;
  orderId?: string;
  message: string;
  timestamp: string;
}

/**
 * 执行单个股票的自动交易策略
 */
export async function executeAutoTradeForStock(
  symbol: string,
  fundamentalScore: number,
  sentimentScore: number,
  technicalScore: number,
  currentPrice: number,
  targetPrice: number,
  newsHeadlines: string[] = []
): Promise<AutoTradeResult> {
  try {
    // 1. 获取AI决策
    const decision = await analyzeWithGemini({
      symbol,
      fundamentalScore,
      sentimentScore,
      technicalScore,
      currentPrice,
      targetPrice,
      newsHeadlines,
    });

    if (!decision) {
      return {
        symbol,
        signal: {
          symbol,
          action: "hold",
          confidence: 0,
          targetPrice: currentPrice,
          reasoning: "AI分析失败",
          scores: {
            fundamental: fundamentalScore,
            sentiment: sentimentScore,
            technical: technicalScore,
            composite: 0,
          },
        },
        executed: false,
        message: "AI决策失败",
        timestamp: new Date().toISOString(),
      };
    }

    const signal: TradeSignal = {
      symbol: decision.symbol,
      action: decision.action,
      confidence: decision.confidence,
      targetPrice: decision.targetPrice,
      reasoning: decision.reasoning,
      scores: decision.scores,
    };

    // 2. 如果是持有，不执行交易
    if (decision.action === "hold") {
      return {
        symbol,
        signal,
        executed: false,
        message: "AI建议持有，不执行交易",
        timestamp: new Date().toISOString(),
      };
    }

    // 3. 获取账户信息进行风险检查
    const accountAssets = await getAccountAssets();
    if (!accountAssets) {
      return {
        symbol,
        signal,
        executed: false,
        message: "无法获取账户信息",
        timestamp: new Date().toISOString(),
      };
    }

    // 4. 计算交易数量（基于账户可用资金的5%）
    const tradeAmount = accountAssets.availableCash * 0.05;
    const quantity = Math.floor(tradeAmount / currentPrice);

    if (quantity <= 0) {
      return {
        symbol,
        signal,
        executed: false,
        message: "账户余额不足，无法执行交易",
        timestamp: new Date().toISOString(),
      };
    }

    // 5. u98ceu9669u68c0u67e5
    const riskConfig = {
      maxLossPerTrade: accountAssets.availableCash * 0.02, // u6700u5927u4e8au7b14u4e8au4eaau4ea4u6613u4e8au4e22u5931
      maxLossPerDay: accountAssets.availableCash * 0.05, // u65e5u6700u5927u4e8au4e22u5931
      maxPositionSize: accountAssets.availableCash * 0.2, // u5355u4e2au6301u4ed3u6700u5927u91d1u989d
      maxTotalPositionSize: accountAssets.availableCash * 0.8, // u603bu6301u4ed3u6700u5927u91d1u989d
      stopLossPercent: 5,
      takeProfitPercent: 10,
      maxOrderSize: 10000,
      minAccountBalance: accountAssets.availableCash * 0.1,
    };

    const riskValidation = validateOrderRisk(
      symbol,
      quantity,
      currentPrice,
      decision.action,
      accountAssets.availableCash,
      new Map(),
      riskConfig,
      0
    );

    if (!riskValidation.isAllowed) {
      return {
        symbol,
        signal,
        executed: false,
        message: `风险检查失败: ${riskValidation.reason}`,
        timestamp: new Date().toISOString(),
      };
    }

    // 6. 执行交易
    const order = await executeAutoTrade(
      symbol,
      decision.action,
      quantity,
      decision.targetPrice,
      decision.confidence < 70 // 低信心度使用市价单，高信心度使用限价单
    );

    if (!order) {
      return {
        symbol,
        signal,
        executed: false,
        message: "交易执行失败",
        timestamp: new Date().toISOString(),
      };
    }

    // 7. 记录决策到数据库
    const db = await getDb();
    if (db) {
      try {
        // 这里应该插入到ai_decisions表
        // await db.insert(aiDecisions).values({...})
      } catch (error) {
        console.error("[AutoTrading] Failed to log decision:", error);
      }
    }

    return {
      symbol,
      signal,
      executed: true,
      orderId: order.orderId,
      message: `交易执行成功: ${decision.action === "buy" ? "买入" : "卖出"} ${quantity}股 @ $${currentPrice.toFixed(2)}`,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[AutoTrading] Error executing trade for ${symbol}:`, error);
    return {
      symbol,
      signal: {
        symbol,
        action: "hold",
        confidence: 0,
        targetPrice: 0,
        reasoning: "执行异常",
        scores: {
          fundamental: 0,
          sentiment: 0,
          technical: 0,
          composite: 0,
        },
      },
      executed: false,
      message: `执行异常: ${error instanceof Error ? error.message : "未知错误"}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 批量执行多个股票的自动交易策略
 */
export async function executeAutoTradeForMultipleStocks(
  stocks: Array<{
    symbol: string;
    fundamentalScore: number;
    sentimentScore: number;
    technicalScore: number;
    currentPrice: number;
    targetPrice: number;
    newsHeadlines?: string[];
  }>
): Promise<AutoTradeResult[]> {
  const results = await Promise.all(
    stocks.map((stock) =>
      executeAutoTradeForStock(
        stock.symbol,
        stock.fundamentalScore,
        stock.sentimentScore,
        stock.technicalScore,
        stock.currentPrice,
        stock.targetPrice,
        stock.newsHeadlines || []
      )
    )
  );

  return results;
}

/**
 * 获取最近的AI决策记录
 */
export async function getRecentAIDecisions(limit: number = 10) {
  try {
    const db = await getDb();
    if (!db) return [];

    // 这里应该查询ai_decisions表
    // const decisions = await db.select().from(aiDecisions).limit(limit).orderBy(desc(aiDecisions.createdAt));
    // return decisions;

    return [];
  } catch (error) {
    console.error("[AutoTrading] Failed to get recent decisions:", error);
    return [];
  }
}
