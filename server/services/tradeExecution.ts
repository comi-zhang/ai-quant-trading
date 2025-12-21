import axios from "axios";

/**
 * Trade Execution Service
 * 通过长桥API执行交易订单
 */

export interface OrderRequest {
  symbol: string;
  quantity: number;
  price?: number; // 限价单时需要
  side: "buy" | "sell";
  orderType: "market" | "limit";
  timeInForce?: "day" | "gtc"; // day = 当日有效, gtc = 撤销前有效
}

export interface OrderResponse {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  orderType: "market" | "limit";
  status: "pending" | "filled" | "partial" | "cancelled" | "rejected";
  filledQuantity: number;
  averagePrice: number;
  timestamp: string;
  errorMessage?: string;
}

const LONGBRIDGE_API_URL = "https://openapi.longportapp.com";

/**
 * 提交市价单
 */
export async function submitMarketOrder(
  request: OrderRequest,
  accessToken: string
): Promise<OrderResponse> {
  if (request.orderType !== "market") {
    throw new Error("Invalid order type for market order");
  }

  try {
    const response = await axios.post(
      `${LONGBRIDGE_API_URL}/v1/trade/order`,
      {
        symbol: request.symbol,
        quantity: request.quantity,
        side: request.side.toUpperCase(),
        order_type: "MO", // Market Order
        time_in_force: request.timeInForce?.toUpperCase() || "DAY",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    return {
      orderId: response.data.order_id,
      symbol: request.symbol,
      side: request.side,
      quantity: request.quantity,
      price: response.data.price || 0,
      orderType: "market",
      status: mapOrderStatus(response.data.status),
      filledQuantity: response.data.filled_quantity || 0,
      averagePrice: response.data.avg_price || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("[Trade Execution] Market order failed:", error);
    return {
      orderId: "",
      symbol: request.symbol,
      side: request.side,
      quantity: request.quantity,
      price: 0,
      orderType: "market",
      status: "rejected",
      filledQuantity: 0,
      averagePrice: 0,
      timestamp: new Date().toISOString(),
      errorMessage: error.response?.data?.message || error.message,
    };
  }
}

/**
 * 提交限价单
 */
export async function submitLimitOrder(
  request: OrderRequest,
  accessToken: string
): Promise<OrderResponse> {
  if (request.orderType !== "limit" || !request.price) {
    throw new Error("Invalid order type or missing price for limit order");
  }

  try {
    const response = await axios.post(
      `${LONGBRIDGE_API_URL}/v1/trade/order`,
      {
        symbol: request.symbol,
        quantity: request.quantity,
        price: request.price,
        side: request.side.toUpperCase(),
        order_type: "LO", // Limit Order
        time_in_force: request.timeInForce?.toUpperCase() || "DAY",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    return {
      orderId: response.data.order_id,
      symbol: request.symbol,
      side: request.side,
      quantity: request.quantity,
      price: request.price,
      orderType: "limit",
      status: mapOrderStatus(response.data.status),
      filledQuantity: response.data.filled_quantity || 0,
      averagePrice: response.data.avg_price || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("[Trade Execution] Limit order failed:", error);
    return {
      orderId: "",
      symbol: request.symbol,
      side: request.side,
      quantity: request.quantity,
      price: request.price || 0,
      orderType: "limit",
      status: "rejected",
      filledQuantity: 0,
      averagePrice: 0,
      timestamp: new Date().toISOString(),
      errorMessage: error.response?.data?.message || error.message,
    };
  }
}

/**
 * 获取订单状态
 */
export async function getOrderStatus(
  orderId: string,
  accessToken: string
): Promise<OrderResponse | null> {
  try {
    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/trade/order/${orderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const data = response.data;
    return {
      orderId: data.order_id,
      symbol: data.symbol,
      side: data.side.toLowerCase(),
      quantity: data.quantity,
      price: data.price || 0,
      orderType: data.order_type === "MO" ? "market" : "limit",
      status: mapOrderStatus(data.status),
      filledQuantity: data.filled_quantity || 0,
      averagePrice: data.avg_price || 0,
      timestamp: new Date(data.created_at).toISOString(),
    };
  } catch (error) {
    console.error(`[Trade Execution] Failed to get order status for ${orderId}:`, error);
    return null;
  }
}

/**
 * 撤销订单
 */
export async function cancelOrder(
  orderId: string,
  accessToken: string
): Promise<boolean> {
  try {
    await axios.delete(`${LONGBRIDGE_API_URL}/v1/trade/order/${orderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    console.log(`[Trade Execution] Order ${orderId} cancelled successfully`);
    return true;
  } catch (error) {
    console.error(`[Trade Execution] Failed to cancel order ${orderId}:`, error);
    return false;
  }
}

/**
 * 获取今日订单列表
 */
export async function getTodayOrders(
  accessToken: string
): Promise<OrderResponse[]> {
  try {
    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/trade/orders/today`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const orders = response.data.orders || [];
    return orders.map((order: any) => ({
      orderId: order.order_id,
      symbol: order.symbol,
      side: order.side.toLowerCase(),
      quantity: order.quantity,
      price: order.price || 0,
      orderType: order.order_type === "MO" ? "market" : "limit",
      status: mapOrderStatus(order.status),
      filledQuantity: order.filled_quantity || 0,
      averagePrice: order.avg_price || 0,
      timestamp: new Date(order.created_at).toISOString(),
    }));
  } catch (error) {
    console.error("[Trade Execution] Failed to get today orders:", error);
    return [];
  }
}

/**
 * 获取历史订单列表
 */
export async function getHistoryOrders(
  accessToken: string,
  limit: number = 100,
  offset: number = 0
): Promise<OrderResponse[]> {
  try {
    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/trade/orders/history`, {
      params: {
        limit,
        offset,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const orders = response.data.orders || [];
    return orders.map((order: any) => ({
      orderId: order.order_id,
      symbol: order.symbol,
      side: order.side.toLowerCase(),
      quantity: order.quantity,
      price: order.price || 0,
      orderType: order.order_type === "MO" ? "market" : "limit",
      status: mapOrderStatus(order.status),
      filledQuantity: order.filled_quantity || 0,
      averagePrice: order.avg_price || 0,
      timestamp: new Date(order.created_at).toISOString(),
    }));
  } catch (error) {
    console.error("[Trade Execution] Failed to get history orders:", error);
    return [];
  }
}

/**
 * 获取账户余额和资金信息
 */
export async function getAccountBalance(accessToken: string): Promise<any> {
  try {
    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/account/balance`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    return {
      totalCash: response.data.total_cash || 0,
      availableCash: response.data.available_cash || 0,
      frozenCash: response.data.frozen_cash || 0,
      currency: response.data.currency || "USD",
      buyingPower: response.data.buying_power || 0,
      marginRatio: response.data.margin_ratio || 0,
    };
  } catch (error) {
    console.error("[Trade Execution] Failed to get account balance:", error);
    return null;
  }
}

/**
 * 获取持仓信息
 */
export async function getPositions(accessToken: string): Promise<any[]> {
  try {
    const response = await axios.get(`${LONGBRIDGE_API_URL}/v1/account/positions`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const positions = response.data.positions || [];
    return positions.map((pos: any) => ({
      symbol: pos.symbol,
      quantity: pos.quantity,
      availableQuantity: pos.available_quantity,
      costPrice: pos.cost_price,
      currentPrice: pos.current_price,
      marketValue: pos.market_value,
      unrealizedPnl: pos.unrealized_pnl,
      unrealizedPnlPercent: pos.unrealized_pnl_percent,
    }));
  } catch (error) {
    console.error("[Trade Execution] Failed to get positions:", error);
    return [];
  }
}

/**
 * 映射订单状态
 */
function mapOrderStatus(
  status: string
): "pending" | "filled" | "partial" | "cancelled" | "rejected" {
  const statusMap: Record<string, "pending" | "filled" | "partial" | "cancelled" | "rejected"> = {
    NEW: "pending",
    FILLED: "filled",
    PARTIALLY_FILLED: "partial",
    CANCELLED: "cancelled",
    REJECTED: "rejected",
    PENDING_CANCEL: "pending",
  };

  return statusMap[status] || "pending";
}
