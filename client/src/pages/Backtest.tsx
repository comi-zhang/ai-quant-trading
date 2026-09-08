import DashboardLayout from "@/components/DashboardLayout";
import { CandleChart } from "@/components/backtest/CandleChart";
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
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertTriangle, Pause, Play, RotateCcw, SkipForward, Square, Loader2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * 策略回测观察台 /backtest
 *
 * 数据流（单一事实来源）：
 *   参数 → createRun → 轮询 run 状态 → getResult（ bars/events/equityCurve/metrics ）
 *   → 前端只做回放游标切片，不重新计算任何业务数值。
 *
 * 成交规则：信号 bar 收盘后决策，下一 bar 开盘价成交（见结果 meta.executionRuleText）。
 */

type RunStatus = "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";

const STATUS_TEXT: Record<RunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败",
};

function fmt(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) + suffix;
}

export default function Backtest() {
  const { isAuthenticated } = useAuth();

  // ---------- 参数 ----------
  const [symbol, setSymbol] = useState("AAPL");
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [startTime, setStartTime] = useState("2026-03-20");
  const [endTime, setEndTime] = useState("2026-09-01");
  const [source, setSource] = useState<"auto" | "fixture" | "longbridge">("auto");
  const [initialCapital, setInitialCapital] = useState("10000");
  const [sizingMode, setSizingMode] = useState<"fixed_amount" | "capital_pct">("capital_pct");
  const [sizingValue, setSizingValue] = useState("0.5");
  const [commission, setCommission] = useState("1");
  const [slippage, setSlippage] = useState("0.0005");
  const [spread, setSpread] = useState("0.0005");
  const [stopLoss, setStopLoss] = useState("0.1");
  const [takeProfit, setTakeProfit] = useState("0.2");
  const [strategyName, setStrategyName] = useState<"ma-cross" | "rsi-reversion">("ma-cross");
  const [strategyParams, setStrategyParams] = useState("fast=5,slow=20");

  // ---------- run 生命周期 ----------
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [runNonce, setRunNonce] = useState(0); // 触发结果重取
  const [resultKey, setResultKey] = useState<string | null>(null); // 防旧数据残留

  // ---------- 回放 ----------
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4); // bar/秒
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const parseParams = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const part of strategyParams.split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim());
      const n = Number(v);
      if (k && Number.isFinite(n)) out[k] = n;
    }
    return out;
  };

  const buildInput = () => ({
    symbol,
    period,
    startTime,
    endTime,
    source: source === "auto" ? undefined : source,
    initialCapital: Number(initialCapital),
    sizing:
      sizingMode === "fixed_amount"
        ? ({ mode: "fixed_amount", amount: Number(sizingValue) } as const)
        : ({ mode: "capital_pct", pct: Number(sizingValue) } as const),
    maxPositionValue: Number(initialCapital) * 10,
    maxOrderSize: 100000,
    commissionPerTrade: Number(commission),
    slippagePct: Number(slippage),
    spreadPct: Number(spread),
    stopLossPct: Number(stopLoss),
    takeProfitPct: Number(takeProfit),
    strategy: { name: strategyName, version: "v1", params: parseParams() },
  });

  // ---------- 数据预览 ----------
  const previewQuery = trpc.backtest.previewHistory.useQuery(
    {
      symbol,
      period,
      startTime,
      endTime,
      source: source === "auto" ? undefined : source,
    },
    { enabled: false, retry: 1 }
  );

  // ---------- mutations / queries ----------
  const createRun = trpc.backtest.createRun.useMutation();
  const cancelRun = trpc.backtest.cancelRun.useMutation();
  const utils = trpc.useUtils();

  const runQuery = trpc.backtest.getRun.useQuery(
    { runId: activeRunId ?? 0 },
    {
      enabled: isAuthenticated && activeRunId !== null,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "queued" || s === "running" || s === "paused" ? 500 : false;
      },
      retry: 1,
    }
  );

  const runStatus = runQuery.data?.status as RunStatus | undefined;

  const resultQuery = trpc.backtest.getResult.useQuery(
    { runId: activeRunId ?? 0 },
    {
      enabled: isAuthenticated && activeRunId !== null && runStatus === "completed",
      retry: false,
      staleTime: Infinity,
    }
  );

  const result = resultQuery.data ?? null;

  // run 完成/失败时停止回放
  useEffect(() => {
    if (runStatus === "completed" && result) {
      setCursor(0);
      setPlaying(false);
      setSelectedEventId(null);
    }
    if (runStatus === "failed" || runStatus === "cancelled") {
      setPlaying(false);
    }
  }, [runStatus, result]);

  // 回放推进
  useEffect(() => {
    if (!playing || !result) return;
    const timer = setInterval(() => {
      setCursor((c) => {
        if (c >= result.bars.length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, result]);

  const handleStart = async () => {
    setSelectedEventId(null);
    setCursor(0);
    setPlaying(false);
    try {
      const run = await createRun.mutateAsync({ input: buildInput() });
      setResultKey(`${run.id}:${runNonce}`);
      setActiveRunId(run.id);
      setRunNonce((n) => n + 1);
    } catch {
      // 错误由 createRun.error 展示
    }
  };

  const handleStop = async () => {
    setPlaying(false);
    if (activeRunId !== null && (runStatus === "queued" || runStatus === "running" || runStatus === "paused")) {
      await cancelRun.mutateAsync({ runId: activeRunId });
      utils.backtest.getRun.invalidate();
    }
  };

  const handleReset = () => {
    setCursor(0);
    setPlaying(false);
    setSelectedEventId(null);
  };

  // ---------- 回放切片 ----------
  const visibleEvents = useMemo(() => {
    if (!result) return [];
    return result.events.filter((e) => e.barIndex <= cursor);
  }, [result, cursor]);

  const markers = useMemo(() => {
    return visibleEvents
      .filter((e) => e.signal === "BUY" || e.signal === "SELL" || e.signal === "PUT")
      .map((e) => ({ barIndex: e.barIndex, type: e.signal as "BUY" | "SELL" | "PUT", eventId: e.id }));
  }, [visibleEvents]);

  const equitySlice = useMemo(() => result?.equityCurve.slice(0, cursor + 1) ?? [], [result, cursor]);
  const currentPoint = equitySlice[equitySlice.length - 1] ?? null;
  const currentDecision = result && cursor < result.decisions.length ? result.decisions[cursor] : null;
  const selectedEvent = useMemo(
    () => result?.events.find((e) => e.id === selectedEventId) ?? null,
    [result, selectedEventId]
  );

  const handleMarkerClick = (eventId: number) => {
    setSelectedEventId(eventId);
    const ev = result?.events.find((e) => e.id === eventId);
    if (ev) setCursor(ev.barIndex);
  };

  const busy = createRun.isPending || runStatus === "queued" || runStatus === "running";
  const preview = previewQuery.data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">策略回测观察台</h2>
          <span className="text-xs text-muted-foreground">paper/backtest 模式 · 不产生真实订单</span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {/* 参数区 */}
          <Card className="p-4 space-y-3 xl:col-span-1">
            <h3 className="font-semibold">回测参数</h3>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="bt-symbol">股票</Label>
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger id="bt-symbol"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bt-period">周期</Label>
                <Select value={period} onValueChange={(v: "day" | "week" | "month") => setPeriod(v)}>
                  <SelectTrigger id="bt-period"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">日K</SelectItem>
                    <SelectItem value="week">周K</SelectItem>
                    <SelectItem value="month">月K</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bt-start">开始</Label>
                <Input id="bt-start" type="date" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-end">结束</Label>
                <Input id="bt-end" type="date" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-source">数据源</Label>
                <Select value={source} onValueChange={(v: "auto" | "fixture" | "longbridge") => setSource(v)}>
                  <SelectTrigger id="bt-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动</SelectItem>
                    <SelectItem value="longbridge">Longbridge（真实）</SelectItem>
                    <SelectItem value="fixture">Fixture（本地）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bt-capital">初始资金</Label>
                <Input id="bt-capital" type="number" min="100" value={initialCapital} onChange={(e) => setInitialCapital(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-sizing">仓位方式</Label>
                <Select value={sizingMode} onValueChange={(v: "fixed_amount" | "capital_pct") => setSizingMode(v)}>
                  <SelectTrigger id="bt-sizing"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="capital_pct">资金比例</SelectItem>
                    <SelectItem value="fixed_amount">固定金额</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bt-sizing-value">{sizingMode === "capital_pct" ? "比例 (0-1)" : "金额"}</Label>
                <Input id="bt-sizing-value" type="number" step="any" value={sizingValue} onChange={(e) => setSizingValue(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-commission">佣金/笔</Label>
                <Input id="bt-commission" type="number" step="any" min="0" value={commission} onChange={(e) => setCommission(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-slippage">滑点</Label>
                <Input id="bt-slippage" type="number" step="any" min="0" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-spread">点差</Label>
                <Input id="bt-spread" type="number" step="any" min="0" value={spread} onChange={(e) => setSpread(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-stop">止损 %</Label>
                <Input id="bt-stop" type="number" step="any" min="0" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-tp">止盈 %</Label>
                <Input id="bt-tp" type="number" step="any" min="0" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bt-strategy">策略</Label>
                <Select value={strategyName} onValueChange={(v: "ma-cross" | "rsi-reversion") => setStrategyName(v)}>
                  <SelectTrigger id="bt-strategy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ma-cross">均线交叉</SelectItem>
                    <SelectItem value="rsi-reversion">RSI 均值回归</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="bt-params">策略参数 (k=v,逗号分隔)</Label>
                <Input id="bt-params" value={strategyParams} onChange={(e) => setStrategyParams(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={() => previewQuery.refetch()} variant="outline" className="flex-1" disabled={previewQuery.isFetching}>
                {previewQuery.isFetching ? "获取中…" : "预览数据"}
              </Button>
              <Button onClick={handleStart} className="flex-1" disabled={busy || !isAuthenticated} data-testid="run-backtest">
                {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />运行中…</> : "开始回测"}
              </Button>
            </div>

            {createRun.error && (
              <p className="text-xs text-destructive">创建失败: {createRun.error.message}</p>
            )}
            {previewQuery.error && (
              <p className="text-xs text-destructive">数据预览失败: {previewQuery.error.message}</p>
            )}
            {preview && (
              <div className="text-xs space-y-1 border border-border rounded p-2" data-testid="data-preview">
                <div>来源: <b>{preview.source}</b> · {preview.bars.length} bars · 时区 {preview.timezone}</div>
                <div>范围: {preview.actualRange ? `${new Date(preview.actualRange.start).toLocaleDateString()} ~ ${new Date(preview.actualRange.end).toLocaleDateString()}` : "无数据"}</div>
                <div>质量: {preview.qualityStatus} · 版本 {preview.dataVersion}</div>
                {preview.warnings.map((w, i) => (
                  <div key={i} className="text-warning">⚠ {w}</div>
                ))}
              </div>
            )}
          </Card>

          {/* 主区域 */}
          <div className="xl:col-span-3 space-y-4">
            {/* 运行控制 */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1" role="group" aria-label="回放控制">
                  <Button
                    size="sm"
                    variant={playing ? "secondary" : "default"}
                    onClick={() => setPlaying(!playing)}
                    disabled={!result}
                    aria-label={playing ? "暂停" : "开始"}
                    data-testid="replay-play-pause"
                  >
                    {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setPlaying(false); setCursor((c) => Math.min(c + 1, (result?.bars.length ?? 1) - 1)); }}
                    disabled={!result}
                    aria-label="单步"
                    data-testid="replay-step"
                  >
                    <SkipForward className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleReset} disabled={!result} aria-label="重置" data-testid="replay-reset">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleStop} disabled={activeRunId === null} aria-label="停止" data-testid="replay-stop">
                    <Square className="w-4 h-4" />
                  </Button>
                </div>

                <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
                  <SelectTrigger className="w-24" aria-label="回放速度"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 4, 8, 16].map((s) => (
                      <SelectItem key={s} value={String(s)}>{s}x</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="text-sm text-muted-foreground" data-testid="replay-status">
                  {runStatus ? `状态: ${STATUS_TEXT[runStatus]}` : "未运行"}
                  {runQuery.data && runStatus !== "completed" && (
                    <> · 进度 {runQuery.data.progressProcessed}/{runQuery.data.progressTotal || "?"}</>
                  )}
                  {result && (
                    <> · bar {cursor + 1}/{result.bars.length} · {result.bars[cursor] ? new Date(result.bars[cursor].timestamp).toLocaleDateString() : ""}</>
                  )}
                </div>

                {currentDecision && (
                  <div className="text-sm ml-auto">
                    当前决策: <b className={
                      currentDecision === "BUY" ? "text-green-500" :
                      currentDecision === "SELL" ? "text-red-500" :
                      currentDecision === "PUT" ? "text-purple-400" : "text-muted-foreground"
                    }>{currentDecision}</b>
                  </div>
                )}
              </div>

              {runStatus === "failed" && runQuery.data?.error && (
                <div className="mt-3 flex items-center gap-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive" data-testid="run-error">
                  <AlertTriangle className="w-4 h-4" /> 回测失败: {runQuery.data.error}（旧结果已清除，不会展示）
                </div>
              )}
              {runStatus === "cancelled" && (
                <div className="mt-3 p-2 bg-warning/10 border border-warning/30 rounded text-sm text-warning">run 已取消</div>
              )}
            </Card>

            {/* 空状态 */}
            {!result && !busy && !runQuery.data && (
              <Card className="p-12 text-center text-muted-foreground" data-testid="empty-state">
                设置参数后点击「开始回测」。数据来源、时间范围和质量状态会明确展示；没有数据时不会展示虚构结果。
              </Card>
            )}
            {busy && (
              <Card className="p-12 text-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                正在获取数据并运行回测…
              </Card>
            )}

            {/* 结果区 */}
            {result && (
              <>
                {/* 元信息 */}
                <Card className="p-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1" data-testid="result-meta">
                  <span>数据源: <b>{result.meta.dataSource}</b> v{result.meta.dataVersion}</span>
                  <span>{result.meta.barCount} bars</span>
                  <span>策略: {result.meta.strategy.name}@{result.meta.strategy.version}</span>
                  <span>成交规则: {result.meta.executionRuleText}</span>
                  {result.meta.warnings.map((w, i) => (
                    <span key={i} className="text-warning">⚠ {w}</span>
                  ))}
                </Card>

                {/* K线图 */}
                <Card className="p-4">
                  <div className="flex items-center gap-4 mb-2 text-xs">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-green-500" style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }}></span> BUY 买入</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-red-500" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}></span> SELL 卖出</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-purple-500 rotate-45"></span> PUT 看跌(未执行)</span>
                    <span className="ml-auto text-muted-foreground">点击标记查看事件详情</span>
                  </div>
                  <CandleChart
                    bars={result.bars.slice(0, cursor + 1)}
                    upToIndex={cursor}
                    markers={markers}
                    selectedEventId={selectedEventId}
                    onMarkerClick={handleMarkerClick}
                  />
                </Card>

                {/* 事件详情 */}
                {selectedEvent && (
                  <Card className="p-4" data-testid="event-detail">
                    <h4 className="font-semibold mb-2">
                      事件 #{selectedEvent.id} · {selectedEvent.signal}
                      {selectedEvent.note && <span className="text-xs text-muted-foreground ml-2">{selectedEvent.note}</span>}
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div><span className="text-muted-foreground">信号时间</span><br />{new Date(selectedEvent.timestamp).toLocaleString()}</div>
                      <div><span className="text-muted-foreground">信号来源</span><br />{selectedEvent.signalSource}</div>
                      <div><span className="text-muted-foreground">bar 收盘</span><br />${fmt(selectedEvent.bar.close)}</div>
                      <div><span className="text-muted-foreground">事件后权益</span><br />${fmt(selectedEvent.equityAfter)}</div>
                      {selectedEvent.execution && (
                        <>
                          <div><span className="text-muted-foreground">成交状态</span><br />{selectedEvent.execution.status}</div>
                          <div><span className="text-muted-foreground">成交</span><br />
                            {selectedEvent.execution.side === "buy" ? "买入" : "卖出"} {selectedEvent.execution.quantity} @ ${fmt(selectedEvent.execution.price)}
                          </div>
                          <div><span className="text-muted-foreground">费用</span><br />
                            佣金 ${fmt(selectedEvent.execution.commission)} · 滑点 ${fmt(selectedEvent.execution.slippageCost, 4)} · 点差 ${fmt(selectedEvent.execution.spreadCost, 4)}
                          </div>
                          <div><span className="text-muted-foreground">本笔 P&L</span><br />
                            <span className={selectedEvent.execution.realizedPnl >= 0 ? "text-green-500" : "text-red-500"}>
                              ${fmt(selectedEvent.execution.realizedPnl)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </Card>
                )}

                {/* 权益与回撤 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card className="p-4">
                    <h4 className="font-semibold mb-2 text-sm">权益曲线（当前: ${fmt(currentPoint?.equity)} · 现金 ${fmt(currentPoint?.cash)} · 持仓 ${fmt(currentPoint?.positionValue)}）</h4>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={equitySlice} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                        <XAxis dataKey="barIndex" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                        <Tooltip
                          formatter={(v: number, name: string) => [`$${fmt(v)}`, { equity: "总权益", cash: "现金", positionValue: "持仓市值" }[name] ?? name]}
                          labelFormatter={(i) => equitySlice[Number(i)] ? new Date(equitySlice[Number(i)].timestamp).toLocaleDateString() : i}
                        />
                        <Line type="monotone" dataKey="equity" stroke="#3b82f6" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="cash" stroke="#6b7280" dot={false} strokeWidth={1} />
                        <Line type="monotone" dataKey="positionValue" stroke="#f59e0b" dot={false} strokeWidth={1} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="text-xs text-muted-foreground mt-1">
                      已实现 P&L: <span className={(currentPoint?.realizedPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}>${fmt(currentPoint?.realizedPnl)}</span>
                      {" · "}未实现 P&L: <span className={(currentPoint?.unrealizedPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}>${fmt(currentPoint?.unrealizedPnl)}</span>
                    </div>
                  </Card>

                  <Card className="p-4">
                    <h4 className="font-semibold mb-2 text-sm">回撤曲线（最大: {fmt(result.metrics.maxDrawdownPct)}%）</h4>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={equitySlice} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                        <XAxis dataKey="barIndex" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} />
                        <Tooltip formatter={(v: number) => [`${fmt(v)}%`, "回撤"]} />
                        <Area type="monotone" dataKey="drawdownPct" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
                      </AreaChart>
                    </ResponsiveContainer>
                    {result.metrics.maxDrawdownInterval && (
                      <div className="text-xs text-muted-foreground mt-1">
                        区间: {new Date(result.metrics.maxDrawdownInterval.start).toLocaleDateString()} ~ {new Date(result.metrics.maxDrawdownInterval.end).toLocaleDateString()}
                      </div>
                    )}
                  </Card>
                </div>

                {/* 指标卡片 */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2" data-testid="metrics-cards">
                  {[
                    { label: "净收益", value: `$${fmt(result.metrics.netProfit)}`, tone: result.metrics.netProfit >= 0 ? "up" : "down" },
                    { label: "收益率", value: fmt(result.metrics.returnPct, 2, "%"), tone: result.metrics.returnPct >= 0 ? "up" : "down" },
                    { label: "年化收益率", value: result.metrics.annualizedReturnPct !== null ? fmt(result.metrics.annualizedReturnPct, 2, "%") : "—" },
                    { label: "最终权益", value: `$${fmt(result.metrics.finalEquity)}` },
                    { label: "最大回撤", value: fmt(result.metrics.maxDrawdownPct, 2, "%"), tone: "down" },
                    { label: "Sharpe", value: result.metrics.sharpe !== null ? fmt(result.metrics.sharpe) : "—" },
                    { label: "Sortino", value: result.metrics.sortino !== null ? fmt(result.metrics.sortino) : "—" },
                    { label: "胜率", value: result.metrics.winRate !== null ? fmt(result.metrics.winRate, 1, "%") : "—" },
                    { label: "交易次数", value: String(result.metrics.totalTrades) },
                    { label: "Profit Factor", value: result.metrics.profitFactor !== null ? fmt(result.metrics.profitFactor) : "—" },
                    { label: "平均盈利", value: result.metrics.avgWin !== null ? `$${fmt(result.metrics.avgWin)}` : "—" },
                    { label: "平均亏损", value: result.metrics.avgLoss !== null ? `$${fmt(result.metrics.avgLoss)}` : "—" },
                    { label: "总佣金", value: `$${fmt(result.metrics.totalCommission)}` },
                    { label: "总滑点", value: `$${fmt(result.metrics.totalSlippageCost, 4)}` },
                    { label: "总点差", value: `$${fmt(result.metrics.totalSpreadCost, 4)}` },
                    { label: "换手率", value: fmt(result.metrics.turnoverPct, 1, "%") },
                    { label: "平均持仓 bar", value: result.metrics.avgHoldingBars !== null ? fmt(result.metrics.avgHoldingBars, 1) : "—" },
                    { label: "最大连亏", value: String(result.metrics.maxConsecutiveLosses) },
                    { label: "买入持有基准", value: fmt(result.metrics.benchmarkReturnPct, 2, "%"), tone: result.metrics.benchmarkReturnPct >= 0 ? "up" : "down" },
                  ].map((m) => (
                    <Card key={m.label} className="p-3">
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                      <div className={`text-lg font-semibold ${m.tone === "up" ? "text-green-500" : m.tone === "down" ? "text-red-500" : ""}`}>
                        {m.value}
                      </div>
                    </Card>
                  ))}
                </div>

                {/* 交易表 */}
                <Card className="p-4">
                  <h4 className="font-semibold mb-2 text-sm">交易事件（截至当前 bar: {visibleEvents.length} 条）</h4>
                  {visibleEvents.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-4">当前区间内暂无交易事件</p>
                  ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                      <table className="data-table text-xs" data-testid="trades-table">
                        <thead>
                          <tr>
                            <th>ID</th><th>时间</th><th>信号</th><th>方向</th><th>数量</th><th>成交价</th>
                            <th>费用</th><th>状态</th><th>本笔P&L</th><th>权益</th><th>决策理由</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleEvents.map((e) => (
                            <tr
                              key={e.id}
                              className={`cursor-pointer hover:bg-card/60 ${e.id === selectedEventId ? "bg-card/80" : ""}`}
                              onClick={() => setSelectedEventId(e.id)}
                            >
                              <td>{e.id}</td>
                              <td>{new Date(e.timestamp).toLocaleDateString()}</td>
                              <td>
                                <span className={
                                  e.signal === "BUY" ? "text-green-500" :
                                  e.signal === "SELL" ? "text-red-500" :
                                  e.signal === "PUT" ? "text-purple-400" : ""
                                }>{e.signal}</span>
                              </td>
                              <td>{e.execution ? (e.execution.side === "buy" ? "买入" : "卖出") : "—"}</td>
                              <td>{e.execution?.quantity ?? "—"}</td>
                              <td>{e.execution ? `$${fmt(e.execution.price)}` : "—"}</td>
                              <td>{e.execution ? `$${fmt(e.execution.commission + e.execution.slippageCost + e.execution.spreadCost, 4)}` : "—"}</td>
                              <td>{e.execution?.status ?? (e.signal === "PUT" ? "signal_only" : "—")}</td>
                              <td className={(e.execution?.realizedPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}>
                                {e.execution ? `$${fmt(e.execution.realizedPnl)}` : "—"}
                              </td>
                              <td>${fmt(e.equityAfter)}</td>
                              <td className="max-w-48 truncate" title={e.signalSource}>{e.signalSource}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
