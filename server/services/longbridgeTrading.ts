import axios from "axios";
import { ENV } from "../_core/env";

/**
 * 长桥真实交易执行服务
 * 通过长桥API执行买卖订单
 */

interface OrderRequest {
  symbol: string;
  quantity: number;
  price?: number; // 限价单价格，不提供则为市价单
  side: "buy" | "sell";
  orderType: "market" | "limit";
  timeInForce?: "day" | "gtc"; // day = 当日有效, gtc = 撤销前有效
}

interface Order {
  orderId: string;
  symbol: string;
  quantity: number;
  price: number;
  side: "buy" | "sell";
  status: "pending" | "filled" | "partial" | "cancelled" | "rejected";
  filledQuantity: number;
  filledPrice: number;
  timestamp: string;
  message?: string;
}

const LONGBRIDGE_API_URL = "https://openapi.longportapp.com";

/**
 * 提交市价单
 * @param symbol 股票代码
 * @param quantity 数量
 * @param side 买入/卖出
 */
export async function submitMarketOrder(
  symbol: string,
  quantity: number,
  side: "buy" | "sell"
): Promise<Order | null> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return null;
    }

    const response = await axios.post(
      `${LONGBRIDGE_API_URL}/v1/trade/order`,
      {
        symbol,
        quantity,
        side: side === "buy" ? 1 : 2, // 1 = buy, 2 = sell
        order_type: 0, // 0 = market order
        time_in_force: 0, // 0 = day
      },
      {
        headers: {
          Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const data = response.data;
    return {
      orderId: data.order_id || "",
      symbol,
      quantity,
      price: data.price || 0,
      side,
      status: "pending",
      filledQuantity: data.filled_quantity || 0,
      filledPrice: data.filled_price || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Longbridge] Failed to submit market order for ${symbol}:`, error);
    return null;
  }
}

/**
 * 提交限价单
 * @param symbol 股票代码
 * @param quantity 数量
 * @param price 限价
 * @param side 买入/卖出
 */
export async function submitLimitOrder(
  symbol: string,
  quantity: number,
  price: number,
  side: "buy" | "sell"
): Promise<Order | null> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return null;
    }

    const response = await axios.post(
      `${LONGBRIDGE_API_URL}/v1/trade/order`,
      {
        symbol,
        quantity,
        price,
        side: side === "buy" ? 1 : 2, // 1 = buy, 2 = sell
        order_type: 1, // 1 = limit order
        time_in_force: 1, // 1 = gtc (good till cancelled)
      },
      {
        headers: {
          Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const data = response.data;
    return {
      orderId: data.order_id || "",
      symbol,
      quantity,
      price,
      side,
      status: "pending",
      filledQuantity: data.filled_quantity || 0,
      filledPrice: data.filled_price || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Longbridge] Failed to submit limit order for ${symbol}:`, error);
    return null;
  }
}

/**
 * 查询订单状态
 * @param orderId 订单ID
 */
export async function getOrderStatus(orderId: string): Promise<Order | null> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return null;
    }

    const response = await axios.get(
      `${LONGBRIDGE_API_URL}/v1/trade/order/${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );

    const data = response.data;
    const statusMap: Record<number, Order["status"]> = {
      0: "pending",
      1: "filled",
      2: "partial",
      3: "cancelled",
      4: "rejected",
    };

    return {
      orderId: data.order_id || "",
      symbol: data.symbol || "",
      quantity: data.quantity || 0,
      price: data.price || 0,
      side: data.side === 1 ? "buy" : "sell",
      status: statusMap[data.status] || "pending",
      filledQuantity: data.filled_quantity || 0,
      filledPrice: data.filled_price || 0,
      timestamp: new Date(data.created_at).toISOString(),
    };
  } catch (error) {
    console.error(`[Longbridge] Failed to get order status for ${orderId}:`, error);
    return null;
  }
}

/**
 * 撤销订单
 * @param orderId 订单ID
 */
export async function cancelOrder(orderId: string): Promise<boolean> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return false;
    }

    await axios.delete(`${LONGBRIDGE_API_URL}/v1/trade/order/${orderId}`, {
      headers: {
        Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 5000,
    });

    return true;
  } catch (error) {
    console.error(`[Longbridge] Failed to cancel order ${orderId}:`, error);
    return false;
  }
}

/**
 * 获取所有订单
 */
export async function getAllOrders(): Promise<Order[]> {
  try {
    if (!ENV.longbridgeAccessToken) {
      console.error("[Longbridge] Access token not configured");
      return [];
    }

    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/trade/orders`, {
      headers: {
        Authorization: `Bearer ${ENV.longbridgeAccessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const dataArray = Array.isArray(response.data) ? response.data : [response.data];
    const statusMap: Record<number, Order["status"]> = {
      0: "pending",
      1: "filled",
      2: "partial",
      3: "cancelled",
      4: "rejected",
    };

    return dataArray.map((data: any) => ({
      orderId: data.order_id || "",
      symbol: data.symbol || "",
      quantity: data.quantity || 0,
      price: data.price || 0,
      side: data.side === 1 ? "buy" : "sell",
      status: statusMap[data.status] || "pending",
      filledQuantity: data.filled_quantity || 0,
      filledPrice: data.filled_price || 0,
      timestamp: new Date(data.created_at).toISOString(),
    }));
  } catch (error) {
    console.error("[Longbridge] Failed to get all orders:", error);
    return [];
  }
}

/**
 * 执行自动交易
 * 基于AI决策自动下单
 */
export async function executeAutoTrade(
  symbol: string,
  action: "buy" | "sell",
  quantity: number,
  targetPrice?: number,
  useMarketOrder: boolean = false
): Promise<Order | null> {
  try {
    if (useMarketOrder) {
      // 使用市价单
      return await submitMarketOrder(symbol, quantity, action);
    } else if (targetPrice) {
      // 使用限价单
      return await submitLimitOrder(symbol, quantity, targetPrice, action);
    } else {
      // 默认市价单
      return await submitMarketOrder(symbol, quantity, action);
    }
  } catch (error) {
    console.error(`[Longbridge] Failed to execute auto trade for ${symbol}:`, error);
    return null;
  }
}
