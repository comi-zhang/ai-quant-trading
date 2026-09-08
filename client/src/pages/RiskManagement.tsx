import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { AlertTriangle, Shield, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 风控配置页面
 * - 配置来自服务端持久化（risk_config 表），保存即生效并记录版本/审计；
 * - kill switch 立即暂停全部新订单；
 * - 无任何 mock 回测/收益数据。
 */

interface FormState {
  maxPositionSize: string;
  maxTotalExposure: string;
  maxOrderQuantity: string;
  maxDailyTrades: string;
  maxDailyLoss: string;
  minAccountBalance: string;
  stopLossPercent: string;
  takeProfitPercent: string;
  enableAutoTrading: boolean;
}

export default function RiskManagement() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const configQuery = trpc.risk.getConfig.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: 1,
  });

  useEffect(() => {
    const c = configQuery.data;
    if (c && form === null) {
      setForm({
        maxPositionSize: String(Number(c.maxPositionSize)),
        maxTotalExposure: String(Number(c.maxTotalExposure)),
        maxOrderQuantity: String(c.maxOrderQuantity),
        maxDailyTrades: String(c.maxDailyTrades),
        maxDailyLoss: String(Number(c.maxDailyLoss)),
        minAccountBalance: String(Number(c.minAccountBalance)),
        stopLossPercent: String(Number(c.stopLossPercent)),
        takeProfitPercent: String(Number(c.takeProfitPercent)),
        enableAutoTrading: c.enableAutoTrading,
      });
    }
  }, [configQuery.data, form]);

  const updateMutation = trpc.risk.updateConfig.useMutation({
    onSuccess: (updated) => {
      setMessage({ ok: true, text: `已保存（版本 v${updated.version}）` });
      utils.risk.getConfig.invalidate();
    },
    onError: (err) => setMessage({ ok: false, text: `保存失败: ${err.message}` }),
  });

  const haltMutation = trpc.risk.haltTrading.useMutation({
    onSuccess: () => {
      setMessage({ ok: true, text: "交易已暂停（kill switch 生效）" });
      utils.risk.getConfig.invalidate();
    },
    onError: (err) => setMessage({ ok: false, text: `操作失败: ${err.message}` }),
  });

  const resumeMutation = trpc.risk.resumeTrading.useMutation({
    onSuccess: () => {
      setMessage({ ok: true, text: "交易已恢复" });
      utils.risk.getConfig.invalidate();
    },
    onError: (err) => setMessage({ ok: false, text: `操作失败: ${err.message}` }),
  });

  const handleSave = () => {
    if (!form) return;
    setMessage(null);
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const int = (v: string) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };
    updateMutation.mutate({
      maxPositionSize: num(form.maxPositionSize),
      maxTotalExposure: num(form.maxTotalExposure),
      maxOrderQuantity: int(form.maxOrderQuantity),
      maxDailyTrades: int(form.maxDailyTrades),
      maxDailyLoss: num(form.maxDailyLoss),
      minAccountBalance: num(form.minAccountBalance) ?? 0,
      stopLossPercent: num(form.stopLossPercent),
      takeProfitPercent: num(form.takeProfitPercent),
      enableAutoTrading: form.enableAutoTrading,
    });
  };

  const halted = configQuery.data?.tradingHalted ?? false;

  const field = (
    id: keyof FormState,
    label: string,
    hint: string,
    opts: { integer?: boolean } = {}
  ) => (
    <div key={id}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={opts.integer ? "1" : "0"}
        step={opts.integer ? "1" : "0.01"}
        value={(form?.[id] as string) ?? ""}
        onChange={(e) => form && setForm({ ...form, [id]: e.target.value })}
      />
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">风险控制</h2>
          {configQuery.data && (
            <span className="text-xs text-muted-foreground">配置版本 v{configQuery.data.version}</span>
          )}
        </div>

        {message && (
          <div
            className={`p-3 rounded-lg border text-sm ${
              message.ok
                ? "bg-positive/10 border-positive/30 text-positive"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
          >
            {message.text}
          </div>
        )}

        {configQuery.error && (
          <div className="p-3 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            配置加载失败: {configQuery.error.message}
          </div>
        )}

        {/* Kill Switch */}
        <Card className={`p-6 border-2 ${halted ? "border-destructive" : "border-border"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {halted ? <ShieldOff className="w-6 h-6 text-destructive" /> : <Shield className="w-6 h-6 text-positive" />}
              <div>
                <h3 className="text-lg font-semibold">Kill Switch（交易总开关）</h3>
                <p className="text-sm text-muted-foreground">
                  {halted
                    ? `交易已暂停${configQuery.data?.haltReason ? `: ${configQuery.data.haltReason}` : ""}。所有新订单将被拒绝。`
                    : "交易正常运行中。暂停后所有新订单立即被拒绝。"}
                </p>
              </div>
            </div>
            {halted ? (
              <Button onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending} variant="outline">
                恢复交易
              </Button>
            ) : (
              <Button
                onClick={() => haltMutation.mutate({ reason: "手动暂停" })}
                disabled={haltMutation.isPending}
                variant="destructive"
              >
                暂停交易
              </Button>
            )}
          </div>
        </Card>

        {/* 配置表单 */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">风控参数</h3>
          {configQuery.isLoading || form === null ? (
            <p className="text-muted-foreground text-center py-8">加载中…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field("maxPositionSize", "单标的最大暴露 ($)", "单个股票持仓市值上限（含新订单）")}
                {field("maxTotalExposure", "总暴露上限 ($)", "全部持仓市值总和上限")}
                {field("maxOrderQuantity", "单笔最大数量 (股)", "单个订单的股数上限", { integer: true })}
                {field("maxDailyTrades", "日最大交易次数", "当日订单数达到上限后拒绝新订单", { integer: true })}
                {field("maxDailyLoss", "日最大亏损 ($)", "当日已实现亏损达到上限后熔断")}
                {field("minAccountBalance", "最小保留余额 ($)", "买入后剩余现金不得低于该值")}
                {field("stopLossPercent", "止损比例 (%)", "持仓止损参考（用于告警与策略）")}
                {field("takeProfitPercent", "止盈比例 (%)", "持仓止盈参考（用于告警与策略）")}
              </div>

              <div className="flex items-center justify-between mt-6 p-4 border border-border rounded-lg">
                <div>
                  <div className="font-semibold">允许自动交易执行</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    仅当服务端 AUTO_TRADING_ENABLED=true 且此开关打开时，策略才会真实下单；否则只产生只读分析。
                  </p>
                </div>
                <Switch
                  checked={form.enableAutoTrading}
                  onCheckedChange={(v) => setForm({ ...form, enableAutoTrading: v })}
                />
              </div>

              <Button onClick={handleSave} disabled={updateMutation.isPending} className="mt-6 w-full">
                {updateMutation.isPending ? "保存中…" : "保存配置"}
              </Button>
            </>
          )}
        </Card>

        {/* 风控说明 */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-3">执行中的风控规则</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>所有订单在服务端基于一致性快照（现金/持仓/当日统计/参考价）评估。</li>
            <li>参考价缺失或过期、现金未知、持仓市值未知时一律拒绝（fail closed）。</li>
            <li>被拒绝的订单持久化留痕，可在订单历史中查看拒绝原因。</li>
            <li>重复提交（相同幂等键）不会产生重复订单。</li>
          </ul>
        </Card>
      </div>
    </DashboardLayout>
  );
}
