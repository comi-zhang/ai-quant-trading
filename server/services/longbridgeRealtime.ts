import axios from "axios";
import { ENV } from "../_core/env";

/**
 * 真实长桥API行情数据服务
 * 获取实时美股价格和K线数据
 */

interface RealTimeQuote {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  timestamp: number;
  change: number;
  changePercent: number;
}

interface KlineBar {
  timestamp: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

const LONGBRIDGE_API_URL = "https://openapi.longportapp.com";
const LONGBRIDGE_QUOTE_URL = "https://openapi.longportapp.com/v1/quote";
const LONGBRIDGE_ACCOUNT_URL = "https://openapi.longportapp.com/v1/asset/account";
const LONGBRIDGE_POSITIONS_URL = "https://openapi.longportapp.com/v1/position";
const LONGBRIDGE_ORDERS_URL = "https://openapi.longportapp.com/v1/order/orders";

/**
 * 获取实时股票报价
 * @param symbol 股票代码 (e.g., "AAPL", "MSFT")
 * @returns 实时报价数据
 */
export async function getRealTimeQuote(symbol: string): Promise<RealTimeQuote | null> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return null;
    }

    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/quote`, {
      headers: {
        Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
        "Content-Type": "application/json",
      },
      params: {
        symbol,
        include_ask_bid: true,
      },
      timeout: 5000,
    });

    const data = response.data;
    if (!data) {
      console.warn(`[Longbridge] No data returned for ${symbol}`);
      return null;
    }

    const lastPrice = parseFloat(data.last_done) || 0;
    const openPrice = parseFloat(data.open) || 0;
    const prevClose = parseFloat(data.prev_close) || openPrice;

    return {
      symbol,
      lastPrice,
      openPrice,
      highPrice: parseFloat(data.high) || 0,
      lowPrice: parseFloat(data.low) || 0,
      volume: parseInt(data.volume) || 0,
      timestamp: Date.now(),
      change: lastPrice - prevClose,
      changePercent: prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0,
    };
  } catch (error) {
    console.error(`[Longbridge] Failed to get quote for ${symbol}:`, error);
    return null;
  }
}

/**
 * 批量获取多个股票的实时报价
 * @param symbols 股票代码数组
 * @returns 实时报价数组
 */
export async function getRealTimeQuotes(symbols: string[]): Promise<RealTimeQuote[]> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return [];
    }

    const quotes: RealTimeQuote[] = [];

    for (const symbol of symbols) {
      const quote = await getRealTimeQuote(symbol);
      if (quote) {
        quotes.push(quote);
      }
    }

    return quotes;
  } catch (error) {
    console.error("[Longbridge] Failed to get quotes:", error);
    return [];
  }
}

/**
 * 获取K线数据
 * @param symbol 股票代码
 * @param period 时间周期 (day, week, month, 1m, 5m, 15m, 30m, 60m)
 * @param limit 限制数量
 * @returns K线数据数组
 */
export async function getKlineData(
  symbol: string,
  period: string = "day",
  limit: number = 100
): Promise<KlineBar[]> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return [];
    }

    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/kline`, {
      headers: {
        Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
        "Content-Type": "application/json",
      },
      params: {
        symbol,
        period,
        count: limit,
      },
      timeout: 10000,
    });

    const dataArray = Array.isArray(response.data) ? response.data : [response.data];

    return dataArray.map((bar: any) => ({
      timestamp: new Date(bar.timestamp).getTime(),
      open: parseFloat(bar.open) || 0,
      close: parseFloat(bar.close) || 0,
      high: parseFloat(bar.high) || 0,
      low: parseFloat(bar.low) || 0,
      volume: parseInt(bar.volume) || 0,
    }));
  } catch (error) {
    console.error(`[Longbridge] Failed to get kline for ${symbol}:`, error);
    return [];
  }
}

/**
 * 获取账户持仓信息
 * @returns 持仓列表
 */
export async function getAccountPositions() {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return [];
    }

    const response = await axios.get(LONGBRIDGE_ACCOUNT_URL, {
      headers: {
        Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 5000,
    });

    return response.data || [];
  } catch (error) {
    console.error("[Longbridge] Failed to get account positions:", error);
    return [];
  }
}

/**
 * 获取账户资产信息
 * @returns 账户资产数据
 */
export async function getAccountAssets() {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return null;
    }

    const response = await axios.get(LONGBRIDGE_ACCOUNT_URL, {
      headers: {
        Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 5000,
    });

    const responseData = response.data;
    console.log("[Longbridge] Account response:", JSON.stringify(responseData, null, 2));

    // 检查响应结构
    if (!responseData || !responseData.data || !responseData.data.list || responseData.data.list.length === 0) {
      console.error("[Longbridge] Invalid response structure:", responseData);
      return null;
    }

    const accountData = responseData.data.list[0];

    // 获取USD币种的现金信息（如果有多个币种）
    let availableCash = 0;
    let currency = "USD";

    if (accountData.cash_infos && Array.isArray(accountData.cash_infos)) {
      // 优先查找USD，其次查找HKD
      const usdInfo = accountData.cash_infos.find((info: any) => info.currency === "USD");
      const hkdInfo = accountData.cash_infos.find((info: any) => info.currency === "HKD");
      const cashInfo = usdInfo || hkdInfo || accountData.cash_infos[0];

      if (cashInfo) {
        availableCash = parseFloat(cashInfo.available_cash) || 0;
        currency = cashInfo.currency || "USD";
      }
    }

    return {
      totalAssets: parseFloat(accountData.total_cash) || 0,
      availableCash: availableCash,
      marketValue: parseFloat(accountData.net_assets) || 0,
      buyingPower: parseFloat(accountData.buy_power) || 0,
      currency: currency,
    };
  } catch (error) {
    console.error("[Longbridge] Failed to get account assets:", error);
    return null;
  }
}
