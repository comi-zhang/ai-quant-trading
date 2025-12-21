import axios from "axios";

/**
 * News Collector Service
 * 使用NewsAPI获取财经新闻并进行本地情绪分析
 */

interface NewsArticle {
  title: string;
  description: string;
  url: string;
  urlToImage: string;
  publishedAt: string;
  source: {
    id: string;
    name: string;
  };
  sentiment: "positive" | "negative" | "neutral";
  sentimentScore: number; // -1 to 1
}

export interface SentimentAnalysisResult {
  symbol: string;
  articles: NewsArticle[];
  averageSentiment: number; // -1 to 1
  sentimentScore: number; // 0 to 100
  timestamp: string;
}

const NEWS_API_URL = "https://newsapi.org/v2";

/**
 * 获取特定股票的新闻
 */
export async function getStockNews(
  symbol: string,
  apiKey: string,
  limit: number = 20
): Promise<NewsArticle[]> {
  try {
    // Extract company name from symbol for better search
    const query = getCompanyNameFromSymbol(symbol);

    const response = await axios.get(`${NEWS_API_URL}/everything`, {
      params: {
        q: query,
        language: "en",
        sortBy: "publishedAt",
        pageSize: limit,
        apiKey,
      },
      timeout: 10000,
    });

    const articles = response.data.articles || [];

    return articles.map((article: any) => ({
      title: article.title,
      description: article.description || "",
      url: article.url,
      urlToImage: article.urlToImage,
      publishedAt: article.publishedAt,
      source: {
        id: article.source.id,
        name: article.source.name,
      },
      sentiment: "neutral" as const,
      sentimentScore: 0,
    }));
  } catch (error) {
    console.error(`[NewsAPI] Failed to get news for ${symbol}:`, error);
    return [];
  }
}

/**
 * 简单的本地情绪分析 (基于关键词)
 * 这是一个简化版本，可以替换为更复杂的NLP模型
 */
export function analyzeSentiment(text: string): { sentiment: "positive" | "negative" | "neutral"; score: number } {
  const lowerText = text.toLowerCase();

  // 积极词汇
  const positiveWords = [
    "gain",
    "surge",
    "rally",
    "soar",
    "bullish",
    "strong",
    "growth",
    "profit",
    "beat",
    "outperform",
    "upgrade",
    "positive",
    "excellent",
    "record",
    "momentum",
    "breakthrough",
    "success",
    "rise",
    "jump",
    "boost",
  ];

  // 消极词汇
  const negativeWords = [
    "fall",
    "decline",
    "drop",
    "crash",
    "bearish",
    "weak",
    "loss",
    "miss",
    "underperform",
    "downgrade",
    "negative",
    "poor",
    "plunge",
    "slump",
    "concern",
    "risk",
    "warning",
    "cut",
    "lower",
    "struggle",
  ];

  let positiveCount = 0;
  let negativeCount = 0;

  positiveWords.forEach((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lowerText.match(regex);
    positiveCount += matches ? matches.length : 0;
  });

  negativeWords.forEach((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lowerText.match(regex);
    negativeCount += matches ? matches.length : 0;
  });

  const totalWords = positiveCount + negativeCount;

  if (totalWords === 0) {
    return { sentiment: "neutral", score: 0 };
  }

  const score = (positiveCount - negativeCount) / totalWords;

  let sentiment: "positive" | "negative" | "neutral";
  if (score > 0.1) {
    sentiment = "positive";
  } else if (score < -0.1) {
    sentiment = "negative";
  } else {
    sentiment = "neutral";
  }

  return { sentiment, score };
}

/**
 * 分析股票的新闻情绪
 */
export async function analyzeStockSentiment(
  symbol: string,
  apiKey: string
): Promise<SentimentAnalysisResult> {
  const articles = await getStockNews(symbol, apiKey);

  // 分析每篇文章的情绪
  const analyzedArticles = articles.map((article) => {
    const titleSentiment = analyzeSentiment(article.title);
    const descriptionSentiment = analyzeSentiment(article.description);

    // 合并标题和描述的情绪
    const combinedScore = (titleSentiment.score + descriptionSentiment.score) / 2;

    let sentiment: "positive" | "negative" | "neutral";
    if (combinedScore > 0.1) {
      sentiment = "positive";
    } else if (combinedScore < -0.1) {
      sentiment = "negative";
    } else {
      sentiment = "neutral";
    }

    return {
      ...article,
      sentiment,
      sentimentScore: combinedScore,
    };
  });

  // 计算平均情绪
  const averageSentiment =
    analyzedArticles.length > 0
      ? analyzedArticles.reduce((sum, article) => sum + article.sentimentScore, 0) / analyzedArticles.length
      : 0;

  // 转换为0-100的评分
  const sentimentScore = (averageSentiment + 1) * 50; // -1 to 1 -> 0 to 100

  return {
    symbol,
    articles: analyzedArticles,
    averageSentiment,
    sentimentScore,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 从股票代码获取公司名称
 */
function getCompanyNameFromSymbol(symbol: string): string {
  const symbolMap: Record<string, string> = {
    "AAPL.US": "Apple",
    "MSFT.US": "Microsoft",
    "GOOGL.US": "Google Alphabet",
    "AMZN.US": "Amazon",
    "TSLA.US": "Tesla",
    "NVDA.US": "NVIDIA",
    "META.US": "Meta Facebook",
    "NFLX.US": "Netflix",
    "GOOG.US": "Google Alphabet",
    "JPM.US": "JPMorgan Chase",
    "V.US": "Visa",
    "JNJ.US": "Johnson & Johnson",
    "WMT.US": "Walmart",
    "PG.US": "Procter & Gamble",
    "DIS.US": "Disney",
  };

  return symbolMap[symbol] || symbol.replace(".US", "");
}

/**
 * 情绪分析评分 (0-100)
 * 基于新闻情绪和文章数量
 */
export function calculateSentimentScore(sentimentResult: SentimentAnalysisResult): number {
  let score = 50; // Base score

  // 基于平均情绪调整
  const sentimentBoost = sentimentResult.averageSentiment * 30; // -1 to 1 -> -30 to 30
  score += sentimentBoost;

  // 基于文章数量调整（更多文章表示更多关注）
  if (sentimentResult.articles.length > 10) {
    score += 5; // High media attention
  } else if (sentimentResult.articles.length < 3) {
    score -= 5; // Low media attention
  }

  // 基于积极文章比例
  const positiveCount = sentimentResult.articles.filter((a) => a.sentiment === "positive").length;
  const positiveRatio = positiveCount / sentimentResult.articles.length;

  if (positiveRatio > 0.6) {
    score += 10; // Mostly positive
  } else if (positiveRatio < 0.3) {
    score -= 10; // Mostly negative
  }

  // Clamp score between 0 and 100
  return Math.max(0, Math.min(100, score));
}
