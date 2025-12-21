import axios from "axios";

/**
 * Alpha Vantage Fundamental Data Service
 * 获取股票基本面数据：市盈率、市净率、ROE、债务比率等
 */

export interface FundamentalData {
  symbol: string;
  peRatio: number | null; // 市盈率
  pbRatio: number | null; // 市净率
  roe: number | null; // 股东权益回报率
  debtToEquity: number | null; // 债务权益比
  currentRatio: number | null; // 流动比率
  quickRatio: number | null; // 速动比率
  grossMargin: number | null; // 毛利率
  operatingMargin: number | null; // 营业利润率
  netMargin: number | null; // 净利率
  eps: number | null; // 每股收益
  bookValuePerShare: number | null; // 每股账面价值
  timestamp: string;
}

const ALPHA_VANTAGE_API_URL = "https://www.alphavantage.co/query";

/**
 * 获取公司概览数据
 */
export async function getCompanyOverview(
  symbol: string,
  apiKey: string
): Promise<FundamentalData | null> {
  try {
    const response = await axios.get(ALPHA_VANTAGE_API_URL, {
      params: {
        function: "OVERVIEW",
        symbol: symbol.replace(".US", ""),
        apikey: apiKey,
      },
      timeout: 10000,
    });

    const data = response.data;

    // Check for API errors
    if (data["Error Message"] || data["Note"]) {
      console.warn(`[Alpha Vantage] API error for ${symbol}:`, data["Error Message"] || data["Note"]);
      return null;
    }

    return {
      symbol,
      peRatio: parseFloat(data.PERatio) || null,
      pbRatio: parseFloat(data.PriceToBookRatio) || null,
      roe: parseFloat(data.ReturnOnEquityTTM) || null,
      debtToEquity: parseFloat(data.DebtToEquity) || null,
      currentRatio: parseFloat(data.CurrentRatio) || null,
      quickRatio: parseFloat(data.QuickRatio) || null,
      grossMargin: parseFloat(data.GrossProfitTTM) || null,
      operatingMargin: parseFloat(data.OperatingMarginTTM) || null,
      netMargin: parseFloat(data.ProfitMargin) || null,
      eps: parseFloat(data.EPS) || null,
      bookValuePerShare: parseFloat(data.BookValue) || null,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Alpha Vantage] Failed to get company overview for ${symbol}:`, error);
    return null;
  }
}

/**
 * 获取收入报表数据
 */
export async function getIncomeStatement(
  symbol: string,
  apiKey: string
): Promise<any | null> {
  try {
    const response = await axios.get(ALPHA_VANTAGE_API_URL, {
      params: {
        function: "INCOME_STATEMENT",
        symbol: symbol.replace(".US", ""),
        apikey: apiKey,
      },
      timeout: 10000,
    });

    const data = response.data;

    if (data["Error Message"] || data["Note"]) {
      console.warn(`[Alpha Vantage] API error for ${symbol}:`, data["Error Message"] || data["Note"]);
      return null;
    }

    return data.annualReports?.[0] || null;
  } catch (error) {
    console.error(`[Alpha Vantage] Failed to get income statement for ${symbol}:`, error);
    return null;
  }
}

/**
 * 获取资产负债表数据
 */
export async function getBalanceSheet(
  symbol: string,
  apiKey: string
): Promise<any | null> {
  try {
    const response = await axios.get(ALPHA_VANTAGE_API_URL, {
      params: {
        function: "BALANCE_SHEET",
        symbol: symbol.replace(".US", ""),
        apikey: apiKey,
      },
      timeout: 10000,
    });

    const data = response.data;

    if (data["Error Message"] || data["Note"]) {
      console.warn(`[Alpha Vantage] API error for ${symbol}:`, data["Error Message"] || data["Note"]);
      return null;
    }

    return data.annualReports?.[0] || null;
  } catch (error) {
    console.error(`[Alpha Vantage] Failed to get balance sheet for ${symbol}:`, error);
    return null;
  }
}

/**
 * 综合基本面评分 (0-100)
 * 基于PE、PB、ROE、利润率等指标
 */
export function calculateFundamentalScore(fundamentalData: FundamentalData): number {
  let score = 50; // Base score

  // PE Ratio scoring: 低PE通常更便宜，但需要考虑行业平均
  // 假设合理PE范围为 15-25
  if (fundamentalData.peRatio && fundamentalData.peRatio > 0) {
    if (fundamentalData.peRatio < 15) {
      score += 15; // Undervalued
    } else if (fundamentalData.peRatio > 25) {
      score -= 10; // Overvalued
    } else {
      score += 5; // Fair value
    }
  }

  // PB Ratio scoring: 低PB通常更便宜
  // 假设合理PB范围为 1-3
  if (fundamentalData.pbRatio && fundamentalData.pbRatio > 0) {
    if (fundamentalData.pbRatio < 1) {
      score += 10; // Undervalued
    } else if (fundamentalData.pbRatio > 3) {
      score -= 5; // Overvalued
    }
  }

  // ROE scoring: 高ROE表示高效率
  // 假设好的ROE > 15%
  if (fundamentalData.roe && fundamentalData.roe > 0) {
    if (fundamentalData.roe > 15) {
      score += 15; // High efficiency
    } else if (fundamentalData.roe > 10) {
      score += 5; // Moderate efficiency
    } else {
      score -= 5; // Low efficiency
    }
  }

  // Debt to Equity scoring: 低债务比率更安全
  // 假设好的D/E < 0.5
  if (fundamentalData.debtToEquity && fundamentalData.debtToEquity >= 0) {
    if (fundamentalData.debtToEquity < 0.5) {
      score += 10; // Low debt
    } else if (fundamentalData.debtToEquity > 1) {
      score -= 10; // High debt
    }
  }

  // Net Margin scoring: 高净利率表示盈利能力强
  // 假设好的净利率 > 10%
  if (fundamentalData.netMargin && fundamentalData.netMargin > 0) {
    if (fundamentalData.netMargin > 10) {
      score += 10; // High profitability
    } else if (fundamentalData.netMargin > 5) {
      score += 5; // Moderate profitability
    }
  }

  // Current Ratio scoring: 流动比率 > 1.5 较好
  if (fundamentalData.currentRatio && fundamentalData.currentRatio > 0) {
    if (fundamentalData.currentRatio > 1.5) {
      score += 5; // Good liquidity
    } else if (fundamentalData.currentRatio < 1) {
      score -= 10; // Poor liquidity
    }
  }

  // Clamp score between 0 and 100
  return Math.max(0, Math.min(100, score));
}
