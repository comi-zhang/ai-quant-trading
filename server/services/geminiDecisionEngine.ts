import axios from "axios";
import { ENV } from "../_core/env";

/**
 * Gemini AI决策引擎
 * 使用Gemini API进行多维度分析和交易决策
 */

interface AnalysisData {
  symbol: string;
  fundamentalScore: number;
  sentimentScore: number;
  technicalScore: number;
  currentPrice: number;
  targetPrice: number;
  newsHeadlines: string[];
}

interface GeminiDecision {
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
  timestamp: string;
}

const GEMINI_API_URL = ENV.geminiApiUrl || "https://gemini.ystone.top";
const GEMINI_API_KEY = ENV.geminiApiKey || "hajimi";

/**
 * 构建分析提示词
 */
function buildAnalysisPrompt(data: AnalysisData): string {
  return `
你是一个专业的量化交易分析师。请基于以下数据进行交易决策分析：

股票代码: ${data.symbol}
当前价格: $${data.currentPrice.toFixed(2)}

分析维度评分（0-100）:
- 基本面评分: ${data.fundamentalScore}
- 舆情评分: ${data.sentimentScore}
- 技术指标评分: ${data.technicalScore}

最新新闻标题:
${data.newsHeadlines.map((h) => `- ${h}`).join("\n")}

请根据以下权重进行综合分析:
- 基本面: 40%
- 舆情分析: 40%
- 技术指标: 20%

请返回JSON格式的决策结果，包含以下字段:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0-100,
  "targetPrice": 数字,
  "reasoning": "详细的分析推理过程（中文）"
}

请确保返回有效的JSON格式。`;
}

/**
 * 调用Gemini API进行决策分析
 */
export async function analyzeWithGemini(data: AnalysisData): Promise<GeminiDecision | null> {
  try {
    if (!GEMINI_API_URL || !GEMINI_API_KEY) {
      console.error("[Gemini] API URL or Key not configured");
      return null;
    }

    const prompt = buildAnalysisPrompt(data);

    const response = await axios.post(
      `${GEMINI_API_URL}/v1/chat/completions`,
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "你是一个专业的量化交易分析师，擅长基本面分析、舆情分析和技术面分析。请提供准确、专业的交易决策建议。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      },
      {
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const content = response.data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("[Gemini] No content in response");
      return null;
    }

    // 解析JSON响应
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Gemini] Could not extract JSON from response:", content);
      return null;
    }

    const decision = JSON.parse(jsonMatch[0]);

    // 计算综合评分（基本面40% + 舆情40% + 技术20%）
    const compositeScore =
      data.fundamentalScore * 0.4 +
      data.sentimentScore * 0.4 +
      data.technicalScore * 0.2;

    return {
      symbol: data.symbol,
      action: decision.action || "hold",
      confidence: Math.min(100, Math.max(0, decision.confidence || 50)),
      targetPrice: decision.targetPrice || data.currentPrice,
      reasoning: decision.reasoning || "无法获取分析理由",
      scores: {
        fundamental: data.fundamentalScore,
        sentiment: data.sentimentScore,
        technical: data.technicalScore,
        composite: Math.round(compositeScore),
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[Gemini] Failed to analyze:", error);
    return null;
  }
}

/**
 * 批量分析多个股票
 */
export async function analyzeMultipleWithGemini(
  dataArray: AnalysisData[]
): Promise<GeminiDecision[]> {
  const results = await Promise.all(
    dataArray.map((data) => analyzeWithGemini(data))
  );
  return results.filter((r) => r !== null) as GeminiDecision[];
}

/**
 * 生成交易信号
 */
export function generateTradingSignal(decision: GeminiDecision): {
  signal: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  action: string;
} {
  const { action, confidence, scores } = decision;

  if (action === "buy" && confidence >= 75) {
    return { signal: "strong_buy", action: "强烈买入" };
  } else if (action === "buy" && confidence >= 60) {
    return { signal: "buy", action: "买入" };
  } else if (action === "sell" && confidence >= 75) {
    return { signal: "strong_sell", action: "强烈卖出" };
  } else if (action === "sell" && confidence >= 60) {
    return { signal: "sell", action: "卖出" };
  } else {
    return { signal: "hold", action: "持有" };
  }
}
