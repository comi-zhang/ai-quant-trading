import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
}

interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

interface Trade {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  timestamp: string;
  status: "filled" | "pending" | "cancelled";
}

interface AIDecision {
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  targetPrice: number;
  reasoning: string;
  timestamp: string;
  scores: {
    fundamental: number;
    sentiment: number;
    technical: number;
    composite: number;
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stocks, setStocks] = useState<StockQuote[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [decisions, setDecisions] = useState<AIDecision[]>([]);
  const [accountBalance, setAccountBalance] = useState(0);
  const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);

  // 从长桥API获取实时行情
  const { data: quotes, isLoading: quotesLoading } = trpc.quote.getQuotes.useQuery(
    { symbols: ["AAPL", "MSFT", "TSLA"] },
    { refetchInterval: 5000 }
  );

  // 从长桥API获取账户资产
  const { data: accountAssets, isLoading: assetsLoading } = trpc.quote.getAccountAssets.useQuery(
    undefined,
    { refetchInterval: 10000 }
  );

  // 更新股票数据
  useEffect(() => {
    if (quotes && quotes.length > 0) {
      const stocksData: StockQuote[] = quotes.map((q) => ({
        symbol: q.symbol,
        price: q.lastPrice,
        change: q.change,
        changePercent: q.changePercent,
        high: q.highPrice,
        low: q.lowPrice,
        volume: q.volume,
      }));
      setStocks(stocksData);
    }
  }, [quotes]);

  // 更新账户信息
  useEffect(() => {
    if (accountAssets) {
      setAccountBalance(accountAssets.availableCash);
      setTotalPortfolioValue(
        accountAssets.totalAssets + (positions.length > 0 ? positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0) : 0)
      );
    }
  }, [accountAssets, positions]);

  // 初始化持仓和交易数据（从长桥API获取）
  useEffect(() => {
    const initializeData = async () => {
      try {
        // 这里应该调用长桥API获取持仓和交易历史
        // 目前使用模拟数据作为占位符
        const mockPositions: Position[] = [];
        const mockTrades: Trade[] = [];
        const mockDecisions: AIDecision[] = [];

        setPositions(mockPositions);
        setTrades(mockTrades);
        setDecisions(mockDecisions);
        setLoading(false);
      } catch (error) {
        console.error("Failed to initialize data:", error);
        setLoading(false);
      }
    };

    initializeData();
  }, []);

  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalUnrealizedPnlPercent =
    totalPortfolioValue > 0 ? (totalUnrealizedPnl / totalPortfolioValue) * 100 : 0;

  if (loading || quotesLoading || assetsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex gap-6">
        {/* 主内容区 */}
        <div className="flex-1 space-y-6">
          {/* 账户概览 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="stat-card">
              <div className="stat-label">账户余额</div>
              <div className="stat-value">${accountBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              <div className="stat-change neutral">可用于交易</div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">组合价值</div>
              <div className="stat-value">${totalPortfolioValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              <div className="stat-change neutral">包含持仓</div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">未实现盈亏</div>
              <div className={`stat-value ${totalUnrealizedPnl >= 0 ? "price-up" : "price-down"}`}>
                ${totalUnrealizedPnl.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </div>
              <div className={`stat-change ${totalUnrealizedPnlPercent >= 0 ? "positive" : "negative"}`}>
                {totalUnrealizedPnlPercent >= 0 ? "+" : ""}
                {totalUnrealizedPnlPercent.toFixed(2)}%
              </div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">持仓数量</div>
              <div className="stat-value">{positions.length}</div>
              <div className="stat-change neutral">{positions.length} 个活跃</div>
            </Card>
          </div>

          {/* 标签页 */}
          <Tabs defaultValue="quotes" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="quotes">市场行情</TabsTrigger>
              <TabsTrigger value="positions">持仓信息</TabsTrigger>
              <TabsTrigger value="trades">交易历史</TabsTrigger>
            </TabsList>

            {/* 市场行情 */}
            <TabsContent value="quotes" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">监控股票（长桥实时数据）</h3>
                <div className="space-y-3">
                  {stocks.map((stock) => (
                    <div
                      key={stock.symbol}
                      className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-card/50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="font-semibold">{stock.symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          高: ${stock.high.toFixed(2)} | 低: ${stock.low.toFixed(2)} | 成交量: {(stock.volume / 1000000).toFixed(1)}M
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold">${stock.price.toFixed(2)}</div>
                        <div
                          className={`flex items-center justify-end gap-1 ${stock.changePercent >= 0 ? "price-up" : "price-down"}`}
                        >
                          {stock.changePercent >= 0 ? (
                            <TrendingUp className="w-4 h-4" />
                          ) : (
                            <TrendingDown className="w-4 h-4" />
                          )}
                          {Math.abs(stock.change).toFixed(2)} ({stock.changePercent.toFixed(2)}%)
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </TabsContent>

            {/* 持仓信息 */}
            <TabsContent value="positions" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">当前持仓</h3>
                {positions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">暂无持仓</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>股票</th>
                          <th>数量</th>
                          <th>成本价</th>
                          <th>现价</th>
                          <th>盈亏</th>
                          <th>收益率</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((pos) => (
                          <tr key={pos.symbol}>
                            <td className="font-semibold">{pos.symbol}</td>
                            <td>{pos.quantity}</td>
                            <td>${pos.entryPrice.toFixed(2)}</td>
                            <td>${pos.currentPrice.toFixed(2)}</td>
                            <td className={pos.unrealizedPnl >= 0 ? "price-up" : "price-down"}>
                              ${pos.unrealizedPnl.toFixed(2)}
                            </td>
                            <td className={pos.unrealizedPnlPercent >= 0 ? "price-up" : "price-down"}>
                              {pos.unrealizedPnlPercent >= 0 ? "+" : ""}
                              {pos.unrealizedPnlPercent.toFixed(2)}%
                            </td>
                            <td>
                              <Button size="sm" variant="outline">
                                平仓
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* 交易历史 */}
            <TabsContent value="trades" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">交易历史</h3>
                {trades.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">暂无交易记录</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>股票</th>
                          <th>方向</th>
                          <th>数量</th>
                          <th>价格</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((trade) => (
                          <tr key={trade.id}>
                            <td>{trade.timestamp}</td>
                            <td className="font-semibold">{trade.symbol}</td>
                            <td>
                              <div
                                className={`inline-flex items-center gap-1 ${trade.side === "buy" ? "price-up" : "price-down"}`}
                              >
                                {trade.side === "buy" ? "买入" : "卖出"}
                              </div>
                            </td>
                            <td>{trade.quantity}</td>
                            <td>${trade.price.toFixed(2)}</td>
                            <td>
                              <span
                                className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                  trade.status === "filled"
                                    ? "bg-positive/10 text-positive"
                                    : trade.status === "pending"
                                      ? "bg-warning/10 text-warning"
                                      : "bg-negative/10 text-negative"
                                }`}
                              >
                                {trade.status === "filled" ? "已成交" : trade.status === "pending" ? "待成交" : "已取消"}
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

        {/* AI策略侧边栏 */}
        <div className="w-80 space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">🤖 AI交易策略</h3>
            {decisions.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">暂无AI决策</p>
            ) : (
              <div className="space-y-3">
                {decisions.map((decision) => (
                  <div
                    key={decision.symbol}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    {/* 决策摘要 */}
                    <div
                      className="p-3 bg-card hover:bg-card/80 cursor-pointer transition-colors"
                      onClick={() =>
                        setExpandedDecision(
                          expandedDecision === decision.symbol ? null : decision.symbol
                        )
                      }
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-base">{decision.symbol}</h4>
                          <p className="text-xs text-muted-foreground mt-1">{decision.timestamp}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-semibold ${
                              decision.action === "buy"
                                ? "bg-positive/10 text-positive"
                                : decision.action === "sell"
                                  ? "bg-negative/10 text-negative"
                                  : "bg-neutral/10 text-neutral"
                            }`}
                          >
                            {decision.action === "buy"
                              ? "买入"
                              : decision.action === "sell"
                                ? "卖出"
                                : "持有"}
                          </div>
                          {expandedDecision === decision.symbol ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      </div>

                      {/* 信心度 */}
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">信心度</span>
                          <span className="text-sm font-semibold">{decision.confidence}%</span>
                        </div>
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              decision.confidence >= 70
                                ? "bg-positive"
                                : decision.confidence >= 50
                                  ? "bg-warning"
                                  : "bg-negative"
                            }`}
                            style={{ width: `${decision.confidence}%` }}
                          />
                        </div>
                      </div>

                      {/* 目标价格 */}
                      <div className="mt-2">
                        <span className="text-xs text-muted-foreground">目标价格</span>
                        <p className="text-sm font-semibold">${decision.targetPrice.toFixed(2)}</p>
                      </div>
                    </div>

                    {/* 详细推理过程 */}
                    {expandedDecision === decision.symbol && (
                      <div className="p-4 bg-muted/30 border-t border-border">
                        <div className="space-y-3">
                          <div>
                            <h5 className="text-sm font-semibold mb-2">分析推理</h5>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {decision.reasoning}
                            </p>
                          </div>

                          <div>
                            <h5 className="text-sm font-semibold mb-2">维度评分</h5>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs">基本面 (40%)</span>
                                <span className="text-xs font-semibold">{decision.scores.fundamental}</span>
                              </div>
                              <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500"
                                  style={{ width: `${decision.scores.fundamental}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs">舆情分析 (40%)</span>
                                <span className="text-xs font-semibold">{decision.scores.sentiment}</span>
                              </div>
                              <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500"
                                  style={{ width: `${decision.scores.sentiment}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs">技术指标 (20%)</span>
                                <span className="text-xs font-semibold">{decision.scores.technical}</span>
                              </div>
                              <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-purple-500"
                                  style={{ width: `${decision.scores.technical}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                                <span className="text-xs font-semibold">综合评分</span>
                                <span className="text-sm font-bold">{decision.scores.composite}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 实时更新提示 */}
          <Card className="p-4 bg-positive/5 border border-positive/20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-positive rounded-full animate-pulse" />
              <p className="text-xs text-positive">实时更新中</p>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              AI策略和账户资产每5-10秒更新一次
            </p>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
