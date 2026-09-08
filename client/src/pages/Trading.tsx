import DashboardLayout from "@/components/DashboardLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useAuth } from "@/_core/hooks/useAuth";
import { AlertCircle, CheckCircle, Clock, XCircle, HelpCircle } from "lucide-react";
import { useState } from "react";
import { randomUUID } from "@/lib/id";

/**
 * 交易执行页面
 * - 市价/限价单完整支持；
 * - 提交前明确确认对话框（账户/标的/方向/数量/估算金额/模式标识）；
 * - 业务结果以状态机状态展示，绝不用 alert 或“请求成功”冒充业务成功。
 */

interface OrderForm {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  price?: number;
  timeInForce: "day" | "gtc";
}

const STOCK_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX"];

const STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "err" | "muted" }> = {
  pending_accept: { label: "待提交", tone: "warn" },
  accepted: { label: "已接受", tone: "warn" },
  rejected: { label: "已拒绝", tone: "err" },
  partial_filled: { label: "部分成交", tone: "warn" },
  filled: { label: "已成交", tone: "ok" },
  cancelling: { label: "撤单中", tone: "warn" },
  cancelled: { label: "已撤销", tone: "muted" },
  expired: { label: "已过期", tone: "muted" },
  unknown: { label: "状态未知", tone: "err" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: "muted" as const };
  const Icon = s.tone === "ok" ? CheckCircle : s.tone === "err" ? XCircle : s.tone === "warn" ? Clock : HelpCircle;
  const cls =
    s.tone === "ok" ? "text-positive" : s.tone === "err" ? "text-destructive" : s.tone === "warn" ? "text-warning" : "text-muted-foreground";
  return (
    <div className={`flex items-center gap-1 font-semibold ${cls}`}>
      <Icon className="w-4 h-4" />
      <span>{s.label}</span>
    </div>
  );
}

const OPEN_STATUSES = new Set(["pending_accept", "accepted", "partial_filled", "cancelling", "unknown"]);

export default function Trading() {
  const { isAuthenticated } = useAuth();
  const [form, setForm] = useState<OrderForm>({
    symbol: "AAPL",
    side: "buy",
    orderType: "market",
    quantity: 10,
    timeInForce: "day",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{
    status: string;
    message: string;
    duplicate: boolean;
  } | null>(null);

  const ordersQuery = trpc.trading.listOrders.useQuery({ limit: 100 }, {
    enabled: isAuthenticated,
    refetchInterval: 15000,
    retry: 1,
  });
  const modeQuery = trpc.trading.getTradingMode.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: 1,
  });
  const assetsQuery = trpc.quote.getAccountAssets.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: 1,
  });

  const orders = ordersQuery.data ?? [];
  const mode = modeQuery.data?.mode ?? "paper";
  const utils = trpc.useUtils();

  const submitMutation = trpc.trading.submitOrder.useMutation({
    onSuccess: (result) => {
      setLastResult({ status: result.status, message: result.message, duplicate: result.duplicate });
      utils.trading.listOrders.invalidate();
      utils.quote.getAccountAssets.invalidate();
      utils.quote.getAccountPositions.invalidate();
    },
    onError: (error) => {
      setLastResult({ status: "error", message: error.message, duplicate: false });
    },
  });

  const cancelMutation = trpc.trading.cancelOrder.useMutation({
    onSuccess: () => {
      utils.trading.listOrders.invalidate();
    },
    onError: (error) => {
      setLastResult({ status: "error", message: `撤单失败: ${error.message}`, duplicate: false });
    },
  });

  const estimatedAmount =
    form.orderType === "limit" && form.price ? form.quantity * form.price : null;

  const handleOpenConfirm = () => {
    setLastResult(null);
    if (!form.symbol || form.quantity <= 0 || !Number.isInteger(form.quantity)) return;
    if (form.orderType === "limit" && (!form.price || form.price <= 0)) return;
    setConfirmOpen(true);
  };

  const handleConfirmSubmit = () => {
    setConfirmOpen(false);
    submitMutation.mutate({
      symbol: form.symbol,
      side: form.side,
      orderType: form.orderType,
      quantity: form.quantity,
      limitPrice: form.orderType === "limit" ? form.price : undefined,
      timeInForce: form.timeInForce,
      clientOrderId: randomUUID(),
    });
  };

  const activeOrders = orders.filter((o) => OPEN_STATUSES.has(o.status));
  const historyOrders = orders.filter((o) => !OPEN_STATUSES.has(o.status));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className={`px-3 py-1 rounded-full text-xs font-semibold ${mode === "live" ? "bg-destructive/20 text-destructive" : "bg-blue-500/20 text-blue-400"}`}>
            {mode === "live" ? "LIVE 真实交易" : "PAPER 模拟交易"}
          </div>
          {assetsQuery.data && (
            <div className="text-sm text-muted-foreground">
              可用现金: ${assetsQuery.data.cash.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>

        {/* 最近一次提交的业务结果 */}
        {lastResult && (
          <div
            className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${
              lastResult.status === "filled" || lastResult.status === "accepted"
                ? "bg-positive/10 border-positive/30 text-positive"
                : lastResult.status === "error" || lastResult.status === "rejected" || lastResult.status === "unknown"
                  ? "bg-destructive/10 border-destructive/30 text-destructive"
                  : "bg-warning/10 border-warning/30 text-warning"
            }`}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>
              {lastResult.duplicate ? "重复请求已去重 · " : ""}
              {STATUS_LABEL[lastResult.status]?.label ?? lastResult.status} · {lastResult.message}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 下单表单 */}
          <div className="lg:col-span-1">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">下单</h3>

              <div className="space-y-4">
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

                <div>
                  <Label htmlFor="side">买卖方向</Label>
                  <Select value={form.side} onValueChange={(value: "buy" | "sell") => setForm({ ...form, side: value })}>
                    <SelectTrigger id="side">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">买入</SelectItem>
                      <SelectItem value="sell">卖出</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="orderType">订单类型</Label>
                  <Select
                    value={form.orderType}
                    onValueChange={(value: "market" | "limit") => setForm({ ...form, orderType: value })}
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

                <div>
                  <Label htmlFor="quantity">数量</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })}
                    placeholder="输入数量"
                  />
                </div>

                {form.orderType === "limit" && (
                  <div>
                    <Label htmlFor="price">限价</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={form.price ?? ""}
                      onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || undefined })}
                      placeholder="输入限价"
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor="timeInForce">有效期</Label>
                  <Select
                    value={form.timeInForce}
                    onValueChange={(value: "day" | "gtc") => setForm({ ...form, timeInForce: value })}
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

                <Button
                  onClick={handleOpenConfirm}
                  disabled={submitMutation.isPending}
                  className={`w-full ${form.side === "buy" ? "bg-positive" : "bg-negative"}`}
                >
                  {submitMutation.isPending ? "提交中…" : `${form.side === "buy" ? "买入" : "卖出"} ${form.quantity} ${form.symbol}`}
                </Button>
              </div>

              <div className="mt-6 p-3 bg-warning/10 border border-warning rounded-lg">
                <div className="flex gap-2">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                  <div className="text-sm text-warning">
                    <p className="font-semibold">风险警告</p>
                    <p className="mt-1">所有订单提交前经过服务端风控检查；被拒绝的订单也会留痕。</p>
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

              <TabsContent value="active" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">活跃订单</h3>
                  {ordersQuery.isLoading ? (
                    <p className="text-muted-foreground text-center py-8">加载中…</p>
                  ) : ordersQuery.error ? (
                    <p className="text-destructive text-center py-8">订单加载失败: {ordersQuery.error.message}</p>
                  ) : activeOrders.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">暂无活跃订单</p>
                  ) : (
                    <div className="space-y-3">
                      {activeOrders.map((order) => (
                        <div
                          key={order.id}
                          className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-card/50 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold">{order.symbol}</h4>
                              <span
                                className={`text-xs font-semibold px-2 py-1 rounded ${
                                  order.side === "buy" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
                                }`}
                              >
                                {order.side === "buy" ? "买入" : "卖出"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {order.orderType === "market" ? "市价单" : `限价 $${Number(order.limitPrice).toFixed(2)}`}
                              </span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{order.mode}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {Number(order.quantity)} 股 · 已成交 {Number(order.filledQuantity)} ·{" "}
                              {new Date(order.createdAt).toLocaleString()}
                            </p>
                            {order.rejectReason && (
                              <p className="text-xs text-destructive mt-1">{order.rejectReason}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-sm text-muted-foreground">状态</div>
                              <StatusBadge status={order.status} />
                            </div>
                            {(order.status === "accepted" || order.status === "partial_filled" || order.status === "pending_accept") && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={cancelMutation.isPending}
                                onClick={() => cancelMutation.mutate({ orderId: order.id })}
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

              <TabsContent value="history" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">订单历史</h3>
                  {ordersQuery.isLoading ? (
                    <p className="text-muted-foreground text-center py-8">加载中…</p>
                  ) : historyOrders.length === 0 ? (
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
                            <th>成交价</th>
                            <th>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyOrders.map((order) => (
                            <tr key={order.id}>
                              <td>{new Date(order.createdAt).toLocaleString()}</td>
                              <td className="font-semibold">{order.symbol}</td>
                              <td>
                                <span className={order.side === "buy" ? "price-up" : "price-down"}>
                                  {order.side === "buy" ? "买入" : "卖出"}
                                </span>
                              </td>
                              <td>{order.orderType === "market" ? "市价" : "限价"}</td>
                              <td>{Number(order.quantity)}</td>
                              <td>{order.avgFillPrice !== null ? `$${Number(order.avgFillPrice).toFixed(2)}` : "—"}</td>
                              <td>
                                <StatusBadge status={order.status} />
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

      {/* 下单确认对话框 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认订单</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${mode === "live" ? "bg-destructive/20 text-destructive" : "bg-blue-500/20 text-blue-400"}`}>
                  {mode === "live" ? "LIVE 真实交易" : "PAPER 模拟交易"}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2">
                  <span className="text-muted-foreground">标的</span>
                  <span className="font-semibold">{form.symbol}.US</span>
                  <span className="text-muted-foreground">方向</span>
                  <span className={`font-semibold ${form.side === "buy" ? "text-positive" : "text-negative"}`}>
                    {form.side === "buy" ? "买入" : "卖出"}
                  </span>
                  <span className="text-muted-foreground">类型</span>
                  <span className="font-semibold">{form.orderType === "market" ? "市价单" : "限价单"}</span>
                  <span className="text-muted-foreground">数量</span>
                  <span className="font-semibold">{form.quantity} 股</span>
                  {form.orderType === "limit" && form.price && (
                    <>
                      <span className="text-muted-foreground">限价</span>
                      <span className="font-semibold">${form.price.toFixed(2)}</span>
                      <span className="text-muted-foreground">估算金额</span>
                      <span className="font-semibold">${estimatedAmount?.toFixed(2)}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">有效期</span>
                  <span className="font-semibold">{form.timeInForce === "day" ? "当日有效" : "撤销前有效"}</span>
                </div>
                <p className="pt-2 text-xs text-muted-foreground">
                  提交前将经过服务端风控检查（现金/暴露/日限额/熔断）；被拒绝的订单会记录原因。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSubmit}>确认提交</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
