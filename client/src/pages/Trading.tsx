import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle, Clock } from "lucide-react";
import { useState } from "react";

/**
 * 交易执行页面
 * 支持市价单和限价单的下单
 */

interface OrderForm {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  price?: number;
  timeInForce: "day" | "gtc";
}

interface Order {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  price: number;
  status: "pending" | "filled" | "partial" | "cancelled";
  filledQuantity: number;
  averagePrice: number;
  timestamp: string;
}

const STOCK_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX"];

export default function Trading() {
  const [form, setForm] = useState<OrderForm>({
    symbol: "AAPL",
    side: "buy",
    orderType: "market",
    quantity: 10,
    timeInForce: "day",
  });

  // 从长桥API获取订单列表
  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = trpc.trading.getAllOrders.useQuery(
    undefined,
    { refetchInterval: 10000 }
  );

  // 转换API数据格式
  const orders: Order[] = ordersData?.map((order: any) => ({
    id: order.orderId || String(Math.random()),
    symbol: order.symbol,
    side: order.side,
    orderType: order.price && order.price > 0 ? "limit" : "market",
    quantity: order.quantity,
    price: order.price || order.filledPrice || 0,
    status: order.status || "pending",
    filledQuantity: order.filledQuantity || 0,
    averagePrice: order.filledPrice || 0,
    timestamp: order.timestamp ? new Date(order.timestamp).toLocaleString() : new Date().toLocaleString(),
  })) || [];

  const [orderHistory, setOrderHistory] = useState<Order[]>([]);

  // 提交订单 mutation
  const submitOrderMutation = trpc.trading.submitMarketOrder.useMutation({
    onSuccess: () => {
      refetchOrders();
      alert(`订单提交成功: ${form.side.toUpperCase()} ${form.quantity} ${form.symbol}`);
      setForm({
        symbol: "AAPL",
        side: "buy",
        orderType: "market",
        quantity: 10,
        timeInForce: "day",
      });
    },
    onError: (error) => {
      alert(`订单提交失败: ${error.message}`);
    },
  });

  // 撤销订单 mutation
  const cancelOrderMutation = trpc.trading.cancelOrder.useMutation({
    onSuccess: () => {
      refetchOrders();
    },
  });

  const handleSubmitOrder = () => {
    // 验证表单
    if (!form.symbol || form.quantity <= 0) {
      alert("Please fill in all required fields");
      return;
    }

    if (form.orderType === "limit" && !form.price) {
      alert("Please enter limit price");
      return;
    }

    // 调用API提交订单
    if (form.orderType === "market") {
      submitOrderMutation.mutate({
        symbol: form.symbol,
        quantity: form.quantity,
        side: form.side,
      });
    } else {
      // 限价单逻辑（需要添加新的mutation）
      alert("限价单功能待实现");
    }
  };

  const handleCancelOrder = (orderId: string) => {
    cancelOrderMutation.mutate({ orderId });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 下单表单 */}
          <div className="lg:col-span-1">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">下单</h3>

              <div className="space-y-4">
                {/* 股票代码 */}
                <div>
                  <Label htmlFor="symbol">股票代码</Label>
                  <Select value={form.symbol} onValueChange={(value) => setForm({ ...form, symbol: value })}>
                    <SelectTrigger id="symbol">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STOCK_SYMBOLS.map((symbol) => (
                        <SelectItem key={symbol} value={symbol}>
                          {symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 买卖方向 */}
                <div>
                  <Label htmlFor="side">买卖方向</Label>
                  <Select value={form.side} onValueChange={(value: any) => setForm({ ...form, side: value })}>
                    <SelectTrigger id="side">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">买入</SelectItem>
                      <SelectItem value="sell">卖出</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 订单类型 */}
                <div>
                  <Label htmlFor="orderType">订单类型</Label>
                  <Select
                    value={form.orderType}
                    onValueChange={(value: any) => setForm({ ...form, orderType: value })}
                  >
                    <SelectTrigger id="orderType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="market">市价单</SelectItem>
                      <SelectItem value="limit">限价单</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 数量 */}
                <div>
                  <Label htmlFor="quantity">数量</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })}
                    placeholder="输入数量"
                  />
                </div>

                {/* 限价单价格 */}
                {form.orderType === "limit" && (
                  <div>
                    <Label htmlFor="price">限价</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      value={form.price || ""}
                      onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || undefined })}
                      placeholder="输入限价"
                    />
                  </div>
                )}

                {/* 有效期 */}
                <div>
                  <Label htmlFor="timeInForce">有效期</Label>
                  <Select
                    value={form.timeInForce}
                    onValueChange={(value: any) => setForm({ ...form, timeInForce: value })}
                  >
                    <SelectTrigger id="timeInForce">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">当日有效</SelectItem>
                      <SelectItem value="gtc">撤销前有效</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 提交按钮 */}
                <Button
                  onClick={handleSubmitOrder}
                  className={`w-full ${form.side === "buy" ? "bg-positive" : "bg-negative"}`}
                >
                  {form.side === "buy" ? "买入" : "卖出"} {form.quantity} {form.symbol}
                </Button>
              </div>

              {/* 风险提示 */}
                <div className="mt-6 p-3 bg-warning/10 border border-warning rounded-lg">
                <div className="flex gap-2">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                  <div className="text-sm text-warning">
                    <p className="font-semibold">风险警告</p>
                    <p className="mt-1">请始终使用止损和止盈单来管理风险。</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* 订单列表 */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="active" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="active">活跃订单</TabsTrigger>
                <TabsTrigger value="history">订单历史</TabsTrigger>
              </TabsList>

              {/* 活跃订单 */}
              <TabsContent value="active" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">活跃订单</h3>

                  {ordersLoading ? (
                    <p className="text-muted-foreground text-center py-8">加载中...</p>
                  ) : orders.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">暂无活跃订单</p>
                  ) : (
                    <div className="space-y-3">
                      {orders
                        .filter((order) => order.status !== "cancelled")
                        .map((order) => (
                          <div
                            key={order.id}
                            className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-card/50 transition-colors"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold">{order.symbol}</h4>
                                <span
                                  className={`text-xs font-semibold px-2 py-1 rounded ${
                                    order.side === "buy"
                                      ? "bg-positive/10 text-positive"
                                      : "bg-negative/10 text-negative"
                                  }`}
                                >
                                  {order.side.toUpperCase()}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {order.orderType === "market" ? "市价单" : `限价 $${order.price.toFixed(2)}`}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {order.quantity} shares | {order.timestamp}
                              </p>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">状态</div>
                                <div className="flex items-center gap-1 font-semibold">
                                  {order.status === "pending" && (
                                    <>
                                      <Clock className="w-4 h-4 text-warning" />
                                      <span className="text-warning">待成交</span>
                                    </>
                                  )}
                                  {order.status === "filled" && (
                                    <>
                                      <CheckCircle className="w-4 h-4 text-positive" />
                                      <span className="text-positive">已成交</span>
                                    </>
                                  )}
                                  {order.status === "partial" && (
                                    <>
                                      <Clock className="w-4 h-4 text-warning" />
                                      <span className="text-warning">部分成交</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {order.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelOrder(order.id)}
                                  className="text-negative hover:text-negative"
                                >
                                  撤销
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* 订单历史 */}
              <TabsContent value="history" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">订单历史</h3>

                  {orders.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">暂无订单历史</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>股票</th>
                            <th>方向</th>
                            <th>类型</th>
                            <th>数量</th>
                            <th>价格</th>
                            <th>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((order) => (
                            <tr key={order.id}>
                              <td>{order.timestamp}</td>
                              <td className="font-semibold">{order.symbol}</td>
                              <td>
                                <span
                                  className={order.side === "buy" ? "price-up" : "price-down"}
                                >
                                  {order.side === "buy" ? "买入" : "卖出"}
                                </span>
                              </td>
                              <td>{order.orderType === "market" ? "市价" : "限价"}</td>
                              <td>{order.quantity}</td>
                              <td>${order.price.toFixed(2)}</td>
                              <td>
                                <span
                                  className={`text-xs font-semibold px-2 py-1 rounded ${
                                    order.status === "filled"
                                      ? "bg-positive/10 text-positive"
                                      : order.status === "pending"
                                        ? "bg-warning/10 text-warning"
                                        : order.status === "partial"
                                          ? "bg-warning/10 text-warning"
                                          : "bg-negative/10 text-negative"
                                  }`}
                                >
                                  {order.status.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
