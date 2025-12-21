import { invokeLLM } from "../_core/llm";
import { FundamentalData, calculateFundamentalScore } from "./alphaVantageData";
import { SentimentAnalysisResult, calculateSentimentScore } from "./newsCollector";
import { calculateTechnicalScore } from "./longbridgeQuote";

/**
 * AI Decision Engine
 * 基于多维度数据（基本面40% + 新闻舆情40% + 技术指标20%）生成交易决策
 */

export interface DecisionInput {
  symbol: string;
  currentPrice: number;
  fundamentalData: FundamentalData;
  sentimentData: SentimentAnalysisResult;
  technicalPrices: number[]; // 最近100个收盘价
}

export interface DecisionOutput {
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number; // 0-100
  targetPrice: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  scores: {
    fundamental: number;
    sentiment: number;
    technical: number;
    composite: number;
  };
}

/**
 * 生成AI交易决策
 */
export async function generateAIDecision(input: DecisionInput): Promise<DecisionOutput> {
  // 计算各维度评分
  const fundamentalScore = calculateFundamentalScore(input.fundamentalData);
  const sentimentScore = calculateSentimentScore(input.sentimentData);
  const technicalScore = calculateTechnicalScore(input.technicalPrices);

  // 加权综合评分 (基本面40% + 新闻舆情40% + 技术指标20%)
  const compositeScore = fundamentalScore * 0.4 + sentimentScore * 0.4 + technicalScore * 0.2;

  // 准备LLM分析的数据
  const analysisPrompt = buildAnalysisPrompt(input, {
    fundamental: fundamentalScore,
    sentiment: sentimentScore,
    technical: technicalScore,
    composite: compositeScore,
  });

  // 调用LLM获取决策建议
  const llmResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an expert quantitative trading analyst. Analyze the provided stock data and generate a trading decision.
        
Your response MUST be a valid JSON object with the following structure:
{
  "action": "buy" | "sell" | "hold",
  "confidence": number (0-100),
  "targetPrice": number,
  "stopLoss": number,
  "takeProfit": number,
  "reasoning": "string explaining the decision"
}

Consider all three factors:
1. Fundamental Analysis (40% weight): Company valuation, profitability, financial health
2. Sentiment Analysis (40% weight): News sentiment, market perception, investor mood
3. Technical Analysis (20% weight): Price trends, momentum, support/resistance levels

Make a decisive recommendation based on the composite score and individual factors.`,
      },
      {
        role: "user",
        content: analysisPrompt as string,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "trading_decision",
        strict: true,
        schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["buy", "sell", "hold"],
              description: "Trading action recommendation",
            },
            confidence: {
              type: "number",
              description: "Confidence level 0-100",
            },
            targetPrice: {
              type: "number",
              description: "Target price for the position",
            },
            stopLoss: {
              type: "number",
              description: "Stop loss price",
            },
            takeProfit: {
              type: "number",
              description: "Take profit price",
            },
            reasoning: {
              type: "string",
              description: "Detailed reasoning for the decision",
            },
          },
          required: ["action", "confidence", "targetPrice", "stopLoss", "takeProfit", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  });

  // 解析LLM响应
  let decision: any = {
    action: "hold",
    confidence: 50,
    targetPrice: input.currentPrice,
    stopLoss: input.currentPrice * 0.95,
    takeProfit: input.currentPrice * 1.05,
    reasoning: "Unable to parse LLM response",
  };

  try {
    const content = llmResponse.choices[0]?.message?.content;
    if (content && typeof content === "string") {
      decision = JSON.parse(content);
    }
  } catch (error) {
    console.error("[AI Decision Engine] Failed to parse LLM response:", error);
  }

  // 验证和调整决策
  const validatedDecision = validateAndAdjustDecision(decision, input.currentPrice, compositeScore);

  return {
    symbol: input.symbol,
    action: validatedDecision.action,
    confidence: validatedDecision.confidence,
    targetPrice: validatedDecision.targetPrice,
    stopLoss: validatedDecision.stopLoss,
    takeProfit: validatedDecision.takeProfit,
    reasoning: validatedDecision.reasoning,
    scores: {
      fundamental: fundamentalScore,
      sentiment: sentimentScore,
      technical: technicalScore,
      composite: compositeScore,
    },
  };
}

/**
 * 构建LLM分析提示
 */
function buildAnalysisPrompt(
  input: DecisionInput,
  scores: {
    fundamental: number;
    sentiment: number;
    technical: number;
    composite: number;
  }
): string {
  const fundamental = input.fundamentalData;
  const sentiment = input.sentimentData;
  const technical = input.technicalPrices;

  const recentPrice = technical[technical.length - 1];
  const priceChange = ((recentPrice - technical[0]) / technical[0]) * 100;

  return `
Stock Analysis Report for ${input.symbol}

CURRENT PRICE: $${input.currentPrice.toFixed(2)}
RECENT PRICE CHANGE: ${priceChange.toFixed(2)}%

FUNDAMENTAL ANALYSIS (Weight: 40%, Score: ${scores.fundamental.toFixed(1)}/100)
- PE Ratio: ${fundamental.peRatio?.toFixed(2) || "N/A"}
- PB Ratio: ${fundamental.pbRatio?.toFixed(2) || "N/A"}
- ROE: ${fundamental.roe?.toFixed(2) || "N/A"}%
- Debt to Equity: ${fundamental.debtToEquity?.toFixed(2) || "N/A"}
- Net Profit Margin: ${fundamental.netMargin?.toFixed(2) || "N/A"}%
- Current Ratio: ${fundamental.currentRatio?.toFixed(2) || "N/A"}
- EPS: ${fundamental.eps?.toFixed(2) || "N/A"}

SENTIMENT ANALYSIS (Weight: 40%, Score: ${scores.sentiment.toFixed(1)}/100)
- News Articles Analyzed: ${sentiment.articles.length}
- Average Sentiment: ${(sentiment.averageSentiment * 100).toFixed(1)}%
- Positive Articles: ${sentiment.articles.filter((a: any) => a.sentiment === "positive").length}
- Negative Articles: ${sentiment.articles.filter((a: any) => a.sentiment === "negative").length}
- Neutral Articles: ${sentiment.articles.filter((a: any) => a.sentiment === "neutral").length}
- Recent Headlines: ${sentiment.articles.slice(0, 3).map((a: any) => `"${a.title}"`).join(", ")}

TECHNICAL ANALYSIS (Weight: 20%, Score: ${scores.technical.toFixed(1)}/100)
- 100-Day Price Range: $${Math.min(...technical).toFixed(2)} - $${Math.max(...technical).toFixed(2)}
- Current Price Position: ${((recentPrice - Math.min(...technical)) / (Math.max(...technical) - Math.min(...technical)) * 100).toFixed(1)}% of range
- Recent Trend: ${priceChange > 0 ? "UPTREND" : "DOWNTREND"}

COMPOSITE SCORE: ${scores.composite.toFixed(1)}/100

Based on this comprehensive analysis, provide a trading decision with:
1. Action (BUY/SELL/HOLD)
2. Confidence level (0-100)
3. Target price
4. Stop loss level
5. Take profit level
6. Detailed reasoning considering all three factors
`;
}

/**
 * 验证和调整决策
 */
function validateAndAdjustDecision(
  decision: any,
  currentPrice: number,
  compositeScore: number
): any {
  // 确保confidence在0-100之间
  let confidence = Math.max(0, Math.min(100, decision.confidence || 50));

  // 根据compositeScore调整confidence
  if (compositeScore < 40) {
    // 低分数应该降低信心
    confidence = Math.min(confidence, 40);
  } else if (compositeScore > 70) {
    // 高分数应该提高信心
    confidence = Math.max(confidence, 60);
  }

  // 验证目标价格
  let targetPrice = decision.targetPrice || currentPrice;
  if (targetPrice <= 0) {
    targetPrice = currentPrice;
  }

  // 验证止损和止盈
  let stopLoss = decision.stopLoss || currentPrice * 0.95;
  let takeProfit = decision.takeProfit || currentPrice * 1.05;

  // 确保止损 < 当前价格 < 止盈
  if (stopLoss >= currentPrice) {
    stopLoss = currentPrice * 0.95;
  }
  if (takeProfit <= currentPrice) {
    takeProfit = currentPrice * 1.05;
  }

  // 如果compositeScore很低，倾向于HOLD
  let action = decision.action || "hold";
  if (compositeScore < 35 && action === "buy") {
    action = "hold";
  } else if (compositeScore > 75 && action === "hold") {
    action = "buy";
  }

  return {
    action,
    confidence,
    targetPrice,
    stopLoss,
    takeProfit,
    reasoning: decision.reasoning || "Analysis complete",
  };
}
