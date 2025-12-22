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
  const { data: quotes, isLoading: quotesLoading, error: quotesError } = trpc.quote.getQuotes.useQuery(
    { symbols: ["AAPL", "MSFT", "TSLA"] },
    { refetchInterval: 5000 }
  );

  // 从长桥API获取账户资产
  const { data: accountAssets, isLoading: assetsLoading, error: assetsError } = trpc.quote.getAccountAssets.useQuery(
    undefined,
    { refetchInterval: 10000 }
  );

  // 获取AI决策结果
  const { data: decisionHistory, isLoading: decisionsLoading, error: decisionsError } = trpc.autoTrading.getDecisionHistory.useQuery(
    { limit: 10 },
    { refetchInterval: 30000 }
  );

  // 调试日志
  useEffect(() => {
    console.log("[Dashboard] quotes:", quotes);
    console.log("[Dashboard] quotesError:", quotesError);
  }, [quotes, quotesError]);

  useEffect(() => {
    console.log("[Dashboard] accountAssets:", accountAssets);
    console.log("[Dashboard] assetsError:", assetsError);
  }, [accountAssets, assetsError]);

  useEffect(() => {
    console.log("[Dashboard] decisionHistory:", decisionHistory);
    console.log("[Dashboard] decisionsError:", decisionsError);
  }, [decisionHistory, decisionsError]);

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
      console.log("[Dashboard] Setting account balance to:", accountAssets.availableCash);
      setAccountBalance(accountAssets.availableCash);
      setTotalPortfolioValue(
        accountAssets.totalAssets + (positions.length > 0 ? positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0) : 0)
      );
    } else {
      console.warn("[Dashboard] accountAssets is null or undefined");
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

        setPositions(mockPositions);
        setTrades(mockTrades);
        setLoading(false);
      } catch (error) {
        console.error("Failed to initialize data:", error);
        setLoading(false);
      }
    };

    initializeData();
  }, []);

  // 更新AI决策结果
  useEffect(() => {
    const mockDecisions: AIDecision[] = [
      {
        symbol: "AAPL",
        action: "buy",
        confidence: 78,
        targetPrice: 205.0,
        reasoning: "基本面良好，技术指标乐观，新闻舆情积极。建议买入。",
        timestamp: new Date().toISOString(),
        scores: {
          fundamental: 82,
          sentiment: 75,
          technical: 76,
          composite: 78,
        },
      },
      {
        symbol: "MSFT",
        action: "hold",
        confidence: 62,
        targetPrice: 450.0,
        reasoning: "基本面稳定，技术指标中性，新闻舆情平衡。建议持有。",
        timestamp: new Date().toISOString(),
        scores: {
          fundamental: 65,
          sentiment: 60,
          technical: 60,
          composite: 62,
        },
      },
      {
        symbol: "TSLA",
        action: "sell",
        confidence: 85,
        targetPrice: 220.0,
        reasoning: "基本面转弱，技术指标看空，新闻舆情消极。建议卖出。",
        timestamp: new Date().toISOString(),
        scores: {
          fundamental: 45,
          sentiment: 40,
          technical: 50,
          composite: 45,
        },
      },
    ];

    setDecisions(mockDecisions);
  }, [decisionHistory]);

  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalUnrealizedPnlPercent = totalPortfolioValue > 0 ? (totalUnrealizedPnl / totalPortfolioValue) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-6">
          {/* 账户统计卡片 */}
          <div className="grid grid-cols-4 gap-4">
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
                  <div className="space-y-3">
                    {positions.map((position) => (
                      <div key={position.symbol} className="flex items-center justify-between p-4 border border-border rounded-lg">
                        <div className="flex-1">
                          <div className="font-semibold">{position.symbol}</div>
                          <div className="text-sm text-muted-foreground">
                            数量: {position.quantity} | 成本: ${position.entryPrice.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold">${(position.currentPrice * position.quantity).toFixed(2)}</div>
                          <div className={position.unrealizedPnl >= 0 ? "price-up" : "price-down"}>
                            {position.unrealizedPnl >= 0 ? "+" : ""}${position.unrealizedPnl.toFixed(2)} ({position.unrealizedPnlPercent.toFixed(2)}%)
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* 交易历史 */}
            <TabsContent value="trades" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">交易历史</h3>
                {trades.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">暂无交易</p>
                ) : (
                  <div className="space-y-3">
                    {trades.map((trade) => (
                      <div key={trade.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                        <div className="flex-1">
                          <div className="font-semibold">
                            {trade.symbol} - {trade.side === "buy" ? "买入" : "卖出"}
                          </div>
                          <div className="text-sm text-muted-foreground">{new Date(trade.timestamp).toLocaleString()}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold">${(trade.price * trade.quantity).toFixed(2)}</div>
                          <div className="text-sm text-muted-foreground">
                            {trade.quantity} @ ${trade.price.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* 右侧AI策略侧边栏 */}
      <div className="w-80 border-l border-border bg-card/50 overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">AI交易策略</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              实时更新中
            </div>
          </div>

          <div className="space-y-3">
            {decisions.map((decision) => (
              <Card key={decision.symbol} className="p-4 cursor-pointer hover:bg-card/80 transition-colors">
                <div
                  onClick={() => setExpandedDecision(expandedDecision === decision.symbol ? null : decision.symbol)}
                  className="space-y-3"
                >
                  {/* 决策头部 */}
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-base">{decision.symbol}</div>
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        decision.action === "buy"
                          ? "bg-green-500/20 text-green-500"
                          : decision.action === "sell"
                            ? "bg-red-500/20 text-red-500"
                            : "bg-yellow-500/20 text-yellow-500"
                      }`}
                    >
                      {decision.action === "buy" ? "买入" : decision.action === "sell" ? "卖出" : "持有"}
                    </div>
                  </div>

                  {/* 信心度 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">信心度</span>
                      <span className="font-semibold">{decision.confidence}%</span>
                    </div>
                    <div className="w-full bg-background rounded-full h-2">
                      <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full" style={{ width: `${decision.confidence}%` }}></div>
                    </div>
                  </div>

                  {/* 目标价格 */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">目标价格</span>
                    <span className="font-semibold">${decision.targetPrice.toFixed(2)}</span>
                  </div>

                  {/* 展开按钮 */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50">
                    <span>维度评分与推理</span>
                    {expandedDecision === decision.symbol ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* 展开的详细信息 */}
                {expandedDecision === decision.symbol && (
                  <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                    {/* 维度评分 */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">维度评分</div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span>基本面 (40%)</span>
                          <span className="font-semibold">{decision.scores.fundamental}/100</span>
                        </div>
                        <div className="w-full bg-background rounded-full h-1.5">
                          <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${decision.scores.fundamental}%` }}></div>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span>舆情分析 (40%)</span>
                          <span className="font-semibold">{decision.scores.sentiment}/100</span>
                        </div>
                        <div className="w-full bg-background rounded-full h-1.5">
                          <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${decision.scores.sentiment}%` }}></div>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span>技术指标 (20%)</span>
                          <span className="font-semibold">{decision.scores.technical}/100</span>
                        </div>
                        <div className="w-full bg-background rounded-full h-1.5">
                          <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${decision.scores.technical}%` }}></div>
                        </div>
                      </div>
                    </div>

                    {/* 推理过程 */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">推理过程</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{decision.reasoning}</p>
                    </div>

                    {/* 时间戳 */}
                    <div className="text-xs text-muted-foreground">
                      {new Date(decision.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
