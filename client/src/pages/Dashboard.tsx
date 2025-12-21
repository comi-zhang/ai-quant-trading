import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDown, ArrowUp, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

/**
 * 交易仪表盘主页面
 * 展示实时行情、持仓信息、交易历史和AI决策过程
 */

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
      {
        id: "3",
        symbol: "TSLA",
        side: "buy",
        quantity: 20,
        price: 238.5,
        timestamp: "2025-12-21 14:45:00",
        status: "pending",
      },
    ];

    const mockDecisions: AIDecision[] = [
      {
        symbol: "AAPL",
        action: "buy",
        confidence: 78,
        targetPrice: 205.0,
        reasoning:
          "Strong fundamental metrics (PE: 28.5, ROE: 82%), positive sentiment (65%), and technical uptrend (RSI: 62)",
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
        reasoning:
          "Moderate fundamentals (PE: 32.1), neutral sentiment (48%), mixed technical signals (RSI: 55)",
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
        reasoning:
          "Excellent growth metrics (ROE: 45%), positive news sentiment (72%), strong technical momentum (RSI: 68)",
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
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 账户概览 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="stat-card">
            <div className="stat-label">Account Balance</div>
            <div className="stat-value">${accountBalance.toLocaleString()}</div>
            <div className="stat-change neutral">Available for trading</div>
          </Card>

          <Card className="stat-card">
            <div className="stat-label">Portfolio Value</div>
            <div className="stat-value">${totalPortfolioValue.toLocaleString()}</div>
            <div className="stat-change neutral">Including positions</div>
          </Card>

          <Card className="stat-card">
            <div className="stat-label">Unrealized P&L</div>
            <div className={`stat-value ${totalUnrealizedPnl >= 0 ? "price-up" : "price-down"}`}>
              ${totalUnrealizedPnl.toLocaleString()}
            </div>
            <div className={`stat-change ${totalUnrealizedPnlPercent >= 0 ? "positive" : "negative"}`}>
              {totalUnrealizedPnlPercent >= 0 ? "+" : ""}
              {totalUnrealizedPnlPercent.toFixed(2)}%
            </div>
          </Card>

          <Card className="stat-card">
            <div className="stat-label">Open Positions</div>
            <div className="stat-value">{positions.length}</div>
            <div className="stat-change neutral">{positions.length} active</div>
          </Card>
        </div>

        {/* 主要标签页 */}
        <Tabs defaultValue="quotes" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="quotes">Market Quotes</TabsTrigger>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="trades">Trade History</TabsTrigger>
            <TabsTrigger value="decisions">AI Decisions</TabsTrigger>
          </TabsList>

          {/* 市场行情标签页 */}
          <TabsContent value="quotes" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Watched Stocks</h3>
              <div className="space-y-3">
                {stocks.map((stock) => (
                  <div
                    key={stock.symbol}
                    className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-card/50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-semibold">{stock.symbol}</div>
                      <div className="text-sm text-muted-foreground">
                        H: ${stock.high.toFixed(2)} | L: ${stock.low.toFixed(2)} | V: {(stock.volume / 1000000).toFixed(1)}M
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold">${stock.price.toFixed(2)}</div>
                      <div
                        className={`flex items-center justify-end gap-1 ${stock.changePercent >= 0 ? "price-up" : "price-down"}`}
                      >
                        {stock.changePercent >= 0 ? (
                          <ArrowUp className="w-4 h-4" />
                        ) : (
                          <ArrowDown className="w-4 h-4" />
                        )}
                        {Math.abs(stock.change).toFixed(2)} ({stock.changePercent.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* 持仓标签页 */}
          <TabsContent value="positions" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Current Positions</h3>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Quantity</th>
                      <th>Entry Price</th>
                      <th>Current Price</th>
                      <th>P&L</th>
                      <th>Return %</th>
                      <th>Action</th>
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
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline">
                              Close
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* 交易历史标签页 */}
          <TabsContent value="trades" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Trade History</h3>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Quantity</th>
                      <th>Price</th>
                      <th>Status</th>
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
                            {trade.side === "buy" ? (
                              <ArrowDown className="w-4 h-4" />
                            ) : (
                              <ArrowUp className="w-4 h-4" />
                            )}
                            {trade.side.toUpperCase()}
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
                            {trade.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* AI决策标签页 */}
          <TabsContent value="decisions" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">AI Trading Decisions</h3>
              <div className="space-y-4">
                {decisions.map((decision) => (
                  <div
                    key={decision.symbol}
                    className="border border-border rounded-lg p-4 hover:bg-card/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-lg">{decision.symbol}</h4>
                        <p className="text-sm text-muted-foreground">{decision.timestamp}</p>
                      </div>
                      <div className="text-right">
                        <div
                          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full font-semibold ${
                            decision.action === "buy"
                              ? "bg-positive/10 text-positive"
                              : decision.action === "sell"
                                ? "bg-negative/10 text-negative"
                                : "bg-neutral/10 text-neutral"
                          }`}
                        >
                          {decision.action === "buy" ? (
                            <TrendingUp className="w-4 h-4" />
                          ) : decision.action === "sell" ? (
                            <TrendingDown className="w-4 h-4" />
                          ) : null}
                          {decision.action.toUpperCase()}
                        </div>
                        <div className="text-sm font-semibold mt-2">
                          Confidence: {decision.confidence}%
                        </div>
                      </div>
                    </div>

                    {/* 评分细节 */}
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      <div className="bg-card p-2 rounded text-center">
                        <div className="text-xs text-muted-foreground">Fundamental</div>
                        <div className="font-semibold">{decision.scores.fundamental}</div>
                      </div>
                      <div className="bg-card p-2 rounded text-center">
                        <div className="text-xs text-muted-foreground">Sentiment</div>
                        <div className="font-semibold">{decision.scores.sentiment}</div>
                      </div>
                      <div className="bg-card p-2 rounded text-center">
                        <div className="text-xs text-muted-foreground">Technical</div>
                        <div className="font-semibold">{decision.scores.technical}</div>
                      </div>
                      <div className="bg-card p-2 rounded text-center">
                        <div className="text-xs text-muted-foreground">Composite</div>
                        <div className="font-semibold text-primary">{decision.scores.composite}</div>
                      </div>
                    </div>

                    {/* 目标价格 */}
                    <div className="mb-3 p-2 bg-card rounded">
                      <div className="text-sm text-muted-foreground">Target Price</div>
                      <div className="font-semibold">${decision.targetPrice.toFixed(2)}</div>
                    </div>

                    {/* 推理 */}
                    <p className="text-sm text-foreground">{decision.reasoning}</p>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
