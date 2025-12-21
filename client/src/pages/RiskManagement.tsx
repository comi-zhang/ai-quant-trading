import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, AlertTriangle, CheckCircle, TrendingDown } from "lucide-react";
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

/**
 * 风险管理页面
 * 展示风险配置、持仓风险评估和回测结果
 */

interface RiskConfig {
  maxLossPerTrade: number;
  maxLossPerDay: number;
  maxPositionSize: number;
  maxTotalPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxOrderSize: number;
  minAccountBalance: number;
}

interface BacktestResult {
  symbol: string;
  totalReturn: number;
  totalReturnPercent: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
}

const mockRiskConfig: RiskConfig = {
  maxLossPerTrade: 500,
  maxLossPerDay: 2000,
  maxPositionSize: 10000,
  maxTotalPositionSize: 50000,
  stopLossPercent: 2.0,
  takeProfitPercent: 5.0,
  maxOrderSize: 1000,
  minAccountBalance: 5000,
};

const mockBacktestResults: BacktestResult[] = [
  {
    symbol: "AAPL",
    totalReturn: 2450,
    totalReturnPercent: 4.9,
    winRate: 62.5,
    profitFactor: 2.15,
    maxDrawdown: 3.2,
    sharpeRatio: 1.85,
    totalTrades: 16,
  },
  {
    symbol: "MSFT",
    totalReturn: 1850,
    totalReturnPercent: 3.7,
    winRate: 58.3,
    profitFactor: 1.92,
    maxDrawdown: 4.1,
    sharpeRatio: 1.42,
    totalTrades: 12,
  },
  {
    symbol: "TSLA",
    totalReturn: 3200,
    totalReturnPercent: 6.4,
    winRate: 65.0,
    profitFactor: 2.58,
    maxDrawdown: 5.5,
    sharpeRatio: 2.12,
    totalTrades: 20,
  },
];

const mockEquityCurve = [
  { date: "2025-12-01", value: 50000 },
  { date: "2025-12-02", value: 50450 },
  { date: "2025-12-03", value: 50200 },
  { date: "2025-12-04", value: 51100 },
  { date: "2025-12-05", value: 50800 },
  { date: "2025-12-06", value: 52300 },
  { date: "2025-12-07", value: 51900 },
  { date: "2025-12-08", value: 53400 },
  { date: "2025-12-09", value: 54200 },
  { date: "2025-12-10", value: 53800 },
  { date: "2025-12-11", value: 55600 },
  { date: "2025-12-12", value: 56200 },
  { date: "2025-12-13", value: 55900 },
  { date: "2025-12-14", value: 57100 },
  { date: "2025-12-15", value: 58300 },
  { date: "2025-12-16", value: 57800 },
  { date: "2025-12-17", value: 59200 },
  { date: "2025-12-18", value: 60100 },
  { date: "2025-12-19", value: 61500 },
  { date: "2025-12-20", value: 62450 },
  { date: "2025-12-21", value: 63200 },
];

export default function RiskManagement() {
  const [config, setConfig] = useState<RiskConfig>(mockRiskConfig);
  const [isEditing, setIsEditing] = useState(false);

  const handleSaveConfig = () => {
    setIsEditing(false);
    alert("Risk configuration saved successfully");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 风险概览 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="stat-card">
            <div className="stat-label">Max Daily Loss</div>
            <div className="stat-value text-negative">${config.maxLossPerDay}</div>
            <div className="stat-change neutral">Per day limit</div>
          </Card>

          <Card className="stat-card">
            <div className="stat-label">Max Position Size</div>
            <div className="stat-value">${config.maxPositionSize}</div>
            <div className="stat-change neutral">Per stock</div>
          </Card>

          <Card className="stat-card">
            <div className="stat-label">Stop Loss</div>
            <div className="stat-value text-negative">{config.stopLossPercent}%</div>
            <div className="stat-change neutral">Default level</div>
          </Card>

          <Card className="stat-card">
            <div className="stat-label">Take Profit</div>
            <div className="stat-value text-positive">{config.takeProfitPercent}%</div>
            <div className="stat-change neutral">Default level</div>
          </Card>
        </div>

        {/* 主要内容 */}
        <Tabs defaultValue="config" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="config">风险配置</TabsTrigger>
            <TabsTrigger value="backtest">回测结果</TabsTrigger>
            <TabsTrigger value="equity">资金曲线</TabsTrigger>
          </TabsList>

          {/* 风险配置 */}
          <TabsContent value="config" className="space-y-4">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold">风险参数</h3>
                <Button
                  onClick={() => setIsEditing(!isEditing)}
                  variant={isEditing ? "outline" : "default"}
                >
                  {isEditing ? "取消" : "编辑"}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 交易限额 */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm text-muted-foreground">交易限额</h4>

                  <div>
                    <Label htmlFor="maxLossPerTrade">Max Loss Per Trade ($)</Label>
                    <Input
                      id="maxLossPerTrade"
                      type="number"
                      value={config.maxLossPerTrade}
                      onChange={(e) =>
                        setConfig({ ...config, maxLossPerTrade: parseFloat(e.target.value) || 0 })
                      }
                      disabled={!isEditing}
                    />
                  </div>

                  <div>
                    <Label htmlFor="maxLossPerDay">Max Loss Per Day ($)</Label>
                    <Input
                      id="maxLossPerDay"
                      type="number"
                      value={config.maxLossPerDay}
                      onChange={(e) =>
                        setConfig({ ...config, maxLossPerDay: parseFloat(e.target.value) || 0 })
                      }
                      disabled={!isEditing}
                    />
                  </div>

                  <div>
                    <Label htmlFor="maxOrderSize">Max Order Size (shares)</Label>
                    <Input
                      id="maxOrderSize"
                      type="number"
                      value={config.maxOrderSize}
                      onChange={(e) =>
                        setConfig({ ...config, maxOrderSize: parseFloat(e.target.value) || 0 })
                      }
                      disabled={!isEditing}
                    />
                  </div>
                </div>

                {/* 持仓限额 */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm text-muted-foreground">持仓限额</h4>

                  <div>
                    <Label htmlFor="maxPositionSize">Max Position Size ($)</Label>
                    <Input
                      id="maxPositionSize"
                      type="number"
                      value={config.maxPositionSize}
                      onChange={(e) =>
                        setConfig({ ...config, maxPositionSize: parseFloat(e.target.value) || 0 })
                      }
                      disabled={!isEditing}
                    />
                  </div>

                  <div>
                    <Label htmlFor="maxTotalPositionSize">Max Total Position Size ($)</Label>
                    <Input
                      id="maxTotalPositionSize"
                      type="number"
                      value={config.maxTotalPositionSize}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          maxTotalPositionSize: parseFloat(e.target.value) || 0,
                        })
                      }
                      disabled={!isEditing}
                    />
                  </div>

                  <div>
                    <Label htmlFor="minAccountBalance">Min Account Balance ($)</Label>
                    <Input
                      id="minAccountBalance"
                      type="number"
                      value={config.minAccountBalance}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          minAccountBalance: parseFloat(e.target.value) || 0,
                        })
                      }
                      disabled={!isEditing}
                    />
                  </div>
                </div>

                {/* 止损止盈 */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm text-muted-foreground">止损止盈</h4>

                  <div>
                    <Label htmlFor="stopLossPercent">Stop Loss (%)</Label>
                    <Input
                      id="stopLossPercent"
                      type="number"
                      step="0.1"
                      value={config.stopLossPercent}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          stopLossPercent: parseFloat(e.target.value) || 0,
                        })
                      }
                      disabled={!isEditing}
                    />
                  </div>

                  <div>
                    <Label htmlFor="takeProfitPercent">Take Profit (%)</Label>
                    <Input
                      id="takeProfitPercent"
                      type="number"
                      step="0.1"
                      value={config.takeProfitPercent}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          takeProfitPercent: parseFloat(e.target.value) || 0,
                        })
                      }
                      disabled={!isEditing}
                    />
                  </div>
                </div>

                {/* 风险提示 */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm text-muted-foreground">风险提醒</h4>
                  <div className="p-4 bg-warning/10 border border-warning rounded-lg">
                    <div className="flex gap-2">
                      <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
                      <div className="text-sm">
                        <p className="font-semibold">Current Settings</p>
                        <p className="mt-2">
                          Daily loss limit: ${config.maxLossPerDay}
                          <br />
                          Max position: ${config.maxPositionSize}
                          <br />
                          Stop loss: {config.stopLossPercent}%
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {isEditing && (
                <div className="flex gap-2 mt-6">
                    <Button onClick={handleSaveConfig} className="bg-positive">
                    保存配置
                  </Button>
                  <Button onClick={() => setIsEditing(false)} variant="outline">
                    取消
                  </Button>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* 回测结果 */}
          <TabsContent value="backtest" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">策略回测结果</h3>

              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>股票</th>
                      <th>总收益</th>
                      <th>收益率</th>
                      <th>胜率</th>
                      <th>盈亏比</th>
                      <th>最大回撤</th>
                      <th>Sharpe比率</th>
                      <th>交易数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockBacktestResults.map((result) => (
                      <tr key={result.symbol}>
                        <td className="font-semibold">{result.symbol}</td>
                        <td className={result.totalReturn >= 0 ? "price-up" : "price-down"}>
                          ${result.totalReturn.toFixed(2)}
                        </td>
                        <td className={result.totalReturnPercent >= 0 ? "price-up" : "price-down"}>
                          {result.totalReturnPercent >= 0 ? "+" : ""}
                          {result.totalReturnPercent.toFixed(2)}%
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {result.winRate >= 55 && (
                              <CheckCircle className="w-4 h-4 text-positive" />
                            )}
                            {result.winRate.toFixed(1)}%
                          </div>
                        </td>
                        <td className={result.profitFactor >= 1.5 ? "price-up" : "price-down"}>
                          {result.profitFactor.toFixed(2)}
                        </td>
                        <td className={result.maxDrawdown <= 5 ? "text-neutral" : "price-down"}>
                          {result.maxDrawdown.toFixed(2)}%
                        </td>
                        <td className={result.sharpeRatio >= 1.5 ? "price-up" : "text-neutral"}>
                          {result.sharpeRatio.toFixed(2)}
                        </td>
                        <td>{result.totalTrades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 回测解释 */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-card border border-border rounded-lg">
                  <h4 className="font-semibold text-sm mb-2">胜率</h4>
                  <p className="text-xs text-muted-foreground">
                    盘利交易的比例。越高越好，通常 50%+ 是不错的。
                  </p>
                </div>
                <div className="p-4 bg-card border border-border rounded-lg">
                  <h4 className="font-semibold text-sm mb-2">盈亏比</h4>
                  <p className="text-xs text-muted-foreground">
                    汛利与亏损的比率。超过 1.5 为不错。
                  </p>
                </div>
                <div className="p-4 bg-card border border-border rounded-lg">
                  <h4 className="font-semibold text-sm mb-2">Sharpe比率</h4>
                  <p className="text-xs text-muted-foreground">
                    风险调整后的收益。超过 1.0 为不错，超过 2.0 是优秀。
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* 资金曲线 */}
          <TabsContent value="equity" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">资金曲线（最运21天）</h3>

              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={mockEquityCurve}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    dot={false}
                    name="Portfolio Value"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>

              {/* 统计信息 */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="stat-card">
                  <div className="stat-label">Starting Value</div>
                  <div className="stat-value">$50,000</div>
                  <div className="stat-change neutral">Initial capital</div>
                </Card>

                <Card className="stat-card">
                  <div className="stat-label">Current Value</div>
                  <div className="stat-value text-positive">$63,200</div>
                  <div className="stat-change positive">+26.4%</div>
                </Card>

                <Card className="stat-card">
                  <div className="stat-label">Max Drawdown</div>
                  <div className="stat-value text-negative">-5.2%</div>
                  <div className="stat-change neutral">Worst peak-to-trough</div>
                </Card>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
