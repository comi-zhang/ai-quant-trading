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
 * @returns 报价数据数组
 */
export async function getRealTimeQuotes(symbols: string[]): Promise<RealTimeQuote[]> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return [];
    }

    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/quote`, {
      headers: {
        Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
        "Content-Type": "application/json",
      },
      params: {
        symbol: symbols.join(","),
        include_ask_bid: true,
      },
      timeout: 10000,
    });

    const dataArray = Array.isArray(response.data) ? response.data : [response.data];

    return dataArray
      .map((data: any) => {
        const symbol = data.symbol || "";
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
      })
      .filter((q) => q.symbol);
  } catch (error) {
    console.error("[Longbridge] Failed to get quotes:", error);
    return [];
  }
}

/**
 * 获取K线数据
 * @param symbol 股票代码
 * @param period K线周期 (day, week, month, 1m, 5m, 15m, 30m, 60m)
 * @param limit 返回数据条数
 * @returns K线数据数组
 */
export async function getKlineData(
  symbol: string,
  period: "day" | "week" | "month" | "1m" | "5m" | "15m" | "30m" | "60m" = "day",
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

    const data = response.data;
    return {
      totalAssets: parseFloat(data.total_cash) || 0,
      availableCash: parseFloat(data.available_cash) || 0,
      marketValue: parseFloat(data.market_value) || 0,
      buyingPower: parseFloat(data.buying_power) || 0,
      currency: data.currency || "USD",
    };
  } catch (error) {
    console.error("[Longbridge] Failed to get account assets:", error);
    return null;
  }
}
