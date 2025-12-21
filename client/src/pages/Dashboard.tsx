import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  useEffect(() => {
    // 模拟数据加载
    const mockStocks: StockQuote[] = [
      {
        symbol: "AAPL",
        price: 195.45,
        change: 2.15,
        changePercent: 1.11,
        high: 196.5,
        low: 193.2,
        volume: 52000000,
      },
      {
        symbol: "MSFT",
        price: 445.89,
        change: -3.21,
        changePercent: -0.71,
        high: 450.0,
        low: 442.5,
        volume: 28000000,
      },
      {
        symbol: "TSLA",
        price: 242.67,
        change: 5.32,
        changePercent: 2.24,
        high: 245.0,
        low: 238.5,
        volume: 120000000,
      },
    ];

    const mockPositions: Position[] = [
      {
        symbol: "AAPL",
        quantity: 100,
        entryPrice: 185.0,
        currentPrice: 195.45,
        unrealizedPnl: 1045.0,
        unrealizedPnlPercent: 5.65,
      },
      {
        symbol: "MSFT",
        quantity: 50,
        entryPrice: 450.0,
        currentPrice: 445.89,
        unrealizedPnl: -205.5,
        unrealizedPnlPercent: -0.91,
      },
    ];

    const mockTrades: Trade[] = [
      {
        id: "1",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        price: 185.0,
        timestamp: "2025-12-21 10:30:00",
        status: "filled",
      },
      {
        id: "2",
        symbol: "MSFT",
        side: "buy",
        quantity: 50,
        price: 450.0,
        timestamp: "2025-12-21 11:15:00",
        status: "filled",
      },
    ];

    const mockDecisions: AIDecision[] = [
      {
        symbol: "AAPL",
        action: "buy",
        confidence: 78,
        targetPrice: 205.0,
        reasoning: "基本面强劲（PE: 28.5, ROE: 82%），舆情积极（65%），技术上升趋势（RSI: 62）",
        timestamp: "2025-12-21 10:00:00",
        scores: {
          fundamental: 75,
          sentiment: 65,
          technical: 85,
          composite: 72,
        },
      },
      {
        symbol: "MSFT",
        action: "hold",
        confidence: 62,
        targetPrice: 450.0,
        reasoning: "基本面一般（PE: 32.1），舆情中立（48%），技术信号混合（RSI: 55）",
        timestamp: "2025-12-21 11:00:00",
        scores: {
          fundamental: 58,
          sentiment: 48,
          technical: 62,
          composite: 56,
        },
      },
      {
        symbol: "TSLA",
        action: "buy",
        confidence: 85,
        targetPrice: 260.0,
        reasoning: "增长指标优秀（ROE: 45%），新闻舆情积极（72%），技术动量强劲（RSI: 68）",
        timestamp: "2025-12-21 14:30:00",
        scores: {
          fundamental: 82,
          sentiment: 72,
          technical: 88,
          composite: 80,
        },
      },
    ];

    setStocks(mockStocks);
    setPositions(mockPositions);
    setTrades(mockTrades);
    setDecisions(mockDecisions);
    setAccountBalance(50000);
    setTotalPortfolioValue(
      50000 + mockPositions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0)
    );
    setLoading(false);
  }, []);

  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalUnrealizedPnlPercent =
    totalPortfolioValue > 0 ? (totalUnrealizedPnl / totalPortfolioValue) * 100 : 0;

  if (loading) {
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
              <div className="stat-value">${accountBalance.toLocaleString()}</div>
              <div className="stat-change neutral">可用于交易</div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">组合价值</div>
              <div className="stat-value">${totalPortfolioValue.toLocaleString()}</div>
              <div className="stat-change neutral">包含持仓</div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">未实现盈亏</div>
              <div className={`stat-value ${totalUnrealizedPnl >= 0 ? "price-up" : "price-down"}`}>
                ${totalUnrealizedPnl.toLocaleString()}
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
                <h3 className="text-lg font-semibold mb-4">监控股票</h3>
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
              </Card>
            </TabsContent>

            {/* 交易历史 */}
            <TabsContent value="trades" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">交易历史</h3>
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
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* AI策略侧边栏 */}
        <div className="w-80 space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">🤖 AI交易策略</h3>
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
                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">目标价: </span>
                      <span className="font-semibold">${decision.targetPrice.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* 展开详情 */}
                  {expandedDecision === decision.symbol && (
                    <div className="p-4 border-t border-border bg-muted/30 space-y-3">
                      {/* 维度评分 */}
                      <div className="space-y-2">
                        <h5 className="text-sm font-semibold">维度评分</h5>

                        <div className="space-y-2">
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground">基本面 (40%)</span>
                              <span className="font-semibold">{decision.scores.fundamental}</span>
                            </div>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500"
                                style={{ width: `${decision.scores.fundamental}%` }}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground">舆情分析 (40%)</span>
                              <span className="font-semibold">{decision.scores.sentiment}</span>
                            </div>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-purple-500"
                                style={{ width: `${decision.scores.sentiment}%` }}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground">技术指标 (20%)</span>
                              <span className="font-semibold">{decision.scores.technical}</span>
                            </div>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-orange-500"
                                style={{ width: `${decision.scores.technical}%` }}
                              />
                            </div>
                          </div>

                          <div className="pt-2 border-t border-border">
                            <div className="flex justify-between text-xs">
                              <span className="font-semibold">综合评分</span>
                              <span className="font-bold text-primary">{decision.scores.composite}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 推理过程 */}
                      <div className="space-y-2">
                        <h5 className="text-sm font-semibold">推理过程</h5>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {decision.reasoning}
                        </p>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          className="flex-1 bg-positive text-white"
                          onClick={() => alert(`执行${decision.symbol}买入操作`)}
                        >
                          执行
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => alert(`查看${decision.symbol}详情`)}
                        >
                          详情
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* 实时更新提示 */}
          <Card className="p-4 bg-positive/5 border-positive/20">
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 rounded-full bg-positive mt-1.5 animate-pulse" />
              <div className="text-sm">
                <p className="font-semibold text-positive">实时更新中</p>
                <p className="text-xs text-muted-foreground mt-1">
                  AI策略每分钟更新一次，账户资产实时同步
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
