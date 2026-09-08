import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useQuoteData, useAccountAssets } from "@/hooks/useQuoteData";
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp, AlertTriangle } from "lucide-react";
import { useState } from "react";

const WATCHED_SYMBOLS = ["AAPL", "MSFT", "TSLA"];

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function ErrorBanner({ error, label }: { error: { message: string } | null; label: string }) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>{label}: {error.message}</span>
    </div>
  );
}

function DataTimestamp({ ts }: { ts?: number }) {
  if (!ts) return null;
  return <span className="text-xs text-muted-foreground">更新于 {new Date(ts).toLocaleTimeString()}</span>;
}

export default function Dashboard() {
  const { user, isAuthenticated } = useAuth();
  const [expandedDecision, setExpandedDecision] = useState<number | null>(null);

  const { quotes, loading: quotesLoading, error: quotesError, dataUpdatedAt: quotesAt } = useQuoteData(WATCHED_SYMBOLS);
  const { assets, loading: assetsLoading, error: assetsError, dataUpdatedAt: assetsAt } = useAccountAssets();

  const positionsQuery = trpc.quote.getAccountPositions.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 15000,
    retry: 1,
  });
  const tradesQuery = trpc.trading.listTrades.useQuery({ limit: 50 }, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
    retry: 1,
  });
  const decisionsQuery = trpc.autoTrading.getDecisionHistory.useQuery({ limit: 10 }, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
    retry: 1,
  });
  const modeQuery = trpc.trading.getTradingMode.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: 1,
  });

  const positions = positionsQuery.data ?? [];
  const trades = tradesQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];
  const mode = modeQuery.data?.mode ?? "paper";

  const totalUnrealizedPnl = positions.reduce((sum, p) => {
    const qty = Number(p.quantity);
    const cur = p.currentPrice !== null ? Number(p.currentPrice) : null;
    const avg = Number(p.avgPrice);
    return cur !== null ? sum + (cur - avg) * qty : sum;
  }, 0);
  const hasIncompletePositions = positions.some((p) => p.currentPrice === null);

  return (
    <DashboardLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-6">
          {/* 模式标识 */}
          <div className="flex items-center justify-between">
            <div className={`px-3 py-1 rounded-full text-xs font-semibold ${mode === "live" ? "bg-destructive/20 text-destructive" : "bg-blue-500/20 text-blue-400"}`}>
              {mode === "live" ? "LIVE 真实交易" : "PAPER 模拟交易"}
            </div>
            <DataTimestamp ts={assetsAt} />
          </div>

          <ErrorBanner error={assetsError as { message: string } | null} label="账户资产加载失败" />

          {/* 账户统计卡片 */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="stat-card">
              <div className="stat-label">可用现金</div>
              <div className="stat-value">
                {assetsLoading ? "…" : assets ? `$${fmt(assets.cash)}` : "—"}
              </div>
              <div className="stat-change neutral">{assets?.currency ?? ""} 可用于交易</div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">总资产</div>
              <div className="stat-value">
                {assetsLoading ? "…" : assets ? `$${fmt(assets.totalAssets)}` : "—"}
              </div>
              <div className="stat-change neutral">现金 + 持仓市值</div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">未实现盈亏</div>
              <div className={`stat-value ${totalUnrealizedPnl >= 0 ? "price-up" : "price-down"}`}>
                {positionsQuery.isLoading ? "…" : `$${fmt(totalUnrealizedPnl)}`}
              </div>
              <div className="stat-change neutral">
                {hasIncompletePositions ? "部分持仓缺少最新价" : "基于最新参考价"}
              </div>
            </Card>

            <Card className="stat-card">
              <div className="stat-label">持仓数量</div>
              <div className="stat-value">{positionsQuery.isLoading ? "…" : positions.length}</div>
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
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">监控股票</h3>
                  <DataTimestamp ts={quotesAt} />
                </div>
                <ErrorBanner error={quotesError as { message: string } | null} label="行情加载失败" />
                {quotesLoading ? (
                  <p className="text-muted-foreground text-center py-8">加载中…</p>
                ) : quotes.length === 0 && !quotesError ? (
                  <p className="text-muted-foreground text-center py-8">暂无行情数据</p>
                ) : (
                  <div className="space-y-3">
                    {quotes.map((stock) => (
                      <div
                        key={stock.symbol}
                        className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-card/50 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="font-semibold">{stock.symbol}</div>
                          <div className="text-sm text-muted-foreground">
                            高: ${fmt(stock.high)} | 低: ${fmt(stock.low)} | 成交量:{" "}
                            {stock.volume !== null ? `${(stock.volume / 1000000).toFixed(1)}M` : "—"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold">${fmt(stock.price)}</div>
                          {stock.changePercent !== null ? (
                            <div
                              className={`flex items-center justify-end gap-1 ${stock.changePercent >= 0 ? "price-up" : "price-down"}`}
                            >
                              {stock.changePercent >= 0 ? (
                                <TrendingUp className="w-4 h-4" />
                              ) : (
                                <TrendingDown className="w-4 h-4" />
                              )}
                              {fmt(stock.change)} ({stock.changePercent.toFixed(2)}%)
                            </div>
                          ) : (
                            <div className="text-muted-foreground text-sm">涨跌未知</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* 持仓信息 */}
            <TabsContent value="positions" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">当前持仓</h3>
                <ErrorBanner error={positionsQuery.error as { message: string } | null} label="持仓加载失败" />
                {positionsQuery.isLoading ? (
                  <p className="text-muted-foreground text-center py-8">加载中…</p>
                ) : positions.length === 0 && !positionsQuery.error ? (
                  <p className="text-muted-foreground text-center py-8">暂无持仓</p>
                ) : (
                  <div className="space-y-3">
                    {positions.map((position) => {
                      const qty = Number(position.quantity);
                      const avg = Number(position.avgPrice);
                      const cur = position.currentPrice !== null ? Number(position.currentPrice) : null;
                      const pnl = cur !== null ? (cur - avg) * qty : null;
                      const pnlPct = cur !== null && avg > 0 ? ((cur - avg) / avg) * 100 : null;
                      return (
                        <div key={position.symbol} className="flex items-center justify-between p-4 border border-border rounded-lg">
                          <div className="flex-1">
                            <div className="font-semibold">{position.symbol}</div>
                            <div className="text-sm text-muted-foreground">
                              数量: {qty} | 成本: ${fmt(avg)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold">
                              {cur !== null ? `$${fmt(cur * qty)}` : "—"}
                            </div>
                            {pnl !== null ? (
                              <div className={pnl >= 0 ? "price-up" : "price-down"}>
                                {pnl >= 0 ? "+" : ""}${fmt(pnl)} ({pnlPct?.toFixed(2)}%)
                              </div>
                            ) : (
                              <div className="text-muted-foreground text-sm">缺少最新价</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* 交易历史 */}
            <TabsContent value="trades" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">交易历史</h3>
                <ErrorBanner error={tradesQuery.error as { message: string } | null} label="交易历史加载失败" />
                {tradesQuery.isLoading ? (
                  <p className="text-muted-foreground text-center py-8">加载中…</p>
                ) : trades.length === 0 && !tradesQuery.error ? (
                  <p className="text-muted-foreground text-center py-8">暂无交易</p>
                ) : (
                  <div className="space-y-3">
                    {trades.map((trade) => (
                      <div key={trade.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                        <div className="flex-1">
                          <div className="font-semibold">
                            {trade.symbol} - {trade.side === "buy" ? "买入" : "卖出"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {new Date(trade.executedAt).toLocaleString()}
                            {Number(trade.realizedPnl) !== 0 && (
                              <span className={Number(trade.realizedPnl) >= 0 ? " price-up" : " price-down"}>
                                {" "}· 已实现 {Number(trade.realizedPnl) >= 0 ? "+" : ""}${fmt(Number(trade.realizedPnl))}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold">${fmt(Number(trade.totalAmount))}</div>
                          <div className="text-sm text-muted-foreground">
                            {Number(trade.quantity)} @ ${fmt(Number(trade.price))}
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
            <h2 className="text-xl font-bold">AI决策记录</h2>
            <DataTimestamp ts={decisionsQuery.dataUpdatedAt} />
          </div>

          <ErrorBanner error={decisionsQuery.error as { message: string } | null} label="决策加载失败" />

          {decisionsQuery.isLoading ? (
            <p className="text-muted-foreground text-center py-8 text-sm">加载中…</p>
          ) : decisions.length === 0 && !decisionsQuery.error ? (
            <p className="text-muted-foreground text-center py-8 text-sm">
              暂无 AI 决策记录。决策由自动分析产生，不会展示虚构信号。
            </p>
          ) : (
            <div className="space-y-3">
              {decisions.map((decision) => (
                <Card key={decision.id} className="p-4 cursor-pointer hover:bg-card/80 transition-colors">
                  <div
                    onClick={() => setExpandedDecision(expandedDecision === decision.id ? null : decision.id)}
                    className="space-y-3"
                  >
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

                    {decision.confidence !== null && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">信心度</span>
                          <span className="font-semibold">{Number(decision.confidence)}%</span>
                        </div>
                        <div className="w-full bg-background rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
                            style={{ width: `${Number(decision.confidence)}%` }}
                          ></div>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50">
                      <span>
                        {decision.dataQuality !== "ok" && (
                          <span className="text-warning mr-2">
                            {decision.dataQuality === "insufficient" ? "数据不足" : "部分数据缺失"}
                          </span>
                        )}
                        {decision.executed ? "已执行" : "未执行"}
                      </span>
                      {expandedDecision === decision.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  {expandedDecision === decision.id && (
                    <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground">维度评分</div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span>基本面</span>
                            <span className="font-semibold">
                              {decision.fundamentalScore !== null ? `${Number(decision.fundamentalScore)}/100` : "无数据"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>舆情分析</span>
                            <span className="font-semibold">
                              {decision.sentimentScore !== null ? `${Number(decision.sentimentScore)}/100` : "无数据"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>技术指标</span>
                            <span className="font-semibold">
                              {decision.technicalScore !== null ? `${Number(decision.technicalScore)}/100` : "无数据"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {decision.reasoning && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">推理过程</div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{decision.reasoning}</p>
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground">
                        {decision.modelVersion && <span className="mr-2">模型: {decision.modelVersion}</span>}
                        {new Date(decision.createdAt).toLocaleString()}
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
