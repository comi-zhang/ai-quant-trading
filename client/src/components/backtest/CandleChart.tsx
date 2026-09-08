import { useMemo, useState } from "react";

/**
 * 轻量 K 线图（OHLC + 成交量 + 信号标记），纯 SVG 实现，无新增依赖。
 *
 * 可访问性：标记同时以形状+颜色+文本区分（不只依赖颜色），
 * 支持键盘聚焦与 Enter/Space 触发，含 aria-label。
 */

export interface ChartBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SignalMarker {
  barIndex: number;
  type: "BUY" | "SELL" | "PUT";
  eventId: number;
}

interface CandleChartProps {
  bars: ChartBar[];
  /** 回放游标：只显示 bars[0..upToIndex] */
  upToIndex: number;
  markers: SignalMarker[];
  selectedEventId: number | null;
  onMarkerClick: (eventId: number) => void;
}

const PRICE_RATIO = 0.72; // 价格区占比，其余为成交量区

export function CandleChart({ bars, upToIndex, markers, selectedEventId, onMarkerClick }: CandleChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const visible = useMemo(() => bars.slice(0, Math.min(upToIndex + 1, bars.length)), [bars, upToIndex]);

  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    if (visible.length === 0) return { minPrice: 0, maxPrice: 1, maxVolume: 1 };
    let min = Infinity;
    let max = -Infinity;
    let vol = 1;
    for (const b of visible) {
      min = Math.min(min, b.low);
      max = Math.max(max, b.high);
      vol = Math.max(vol, b.volume);
    }
    const pad = (max - min) * 0.05 || 1;
    return { minPrice: min - pad, maxPrice: max + pad, maxVolume: vol };
  }, [visible]);

  const W = 1000;
  const H = 420;
  const priceH = H * PRICE_RATIO;
  const volH = H - priceH;
  const n = Math.max(visible.length, 1);
  const slot = W / n;
  const bodyW = Math.max(1, Math.min(slot * 0.7, 14));

  const y = (price: number) => priceH - ((price - minPrice) / (maxPrice - minPrice || 1)) * priceH;
  const vy = (v: number) => H - (v / maxVolume) * volH;

  const markerByEvent = useMemo(() => {
    const m = new Map<number, SignalMarker & { y: number; x: number }>();
    for (const mk of markers) {
      if (mk.barIndex >= visible.length) continue;
      const bar = visible[mk.barIndex];
      const x = mk.barIndex * slot + slot / 2;
      const my = mk.type === "BUY" ? y(bar.low) + 18 : y(bar.high) - 18;
      m.set(mk.eventId, { ...mk, x, y: my });
    }
    return m;
  }, [markers, visible, slot, minPrice, maxPrice]);

  const hoverBar = hoverIndex !== null && hoverIndex < visible.length ? visible[hoverIndex] : null;

  return (
    <div className="relative w-full" data-testid="candle-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto bg-background rounded-lg border border-border"
        role="img"
        aria-label={`K线图，共 ${visible.length} 根K线`}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* 网格线 */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={0} x2={W} y1={priceH * r} y2={priceH * r} stroke="currentColor" strokeOpacity={0.08} />
        ))}

        {/* K线 */}
        {visible.map((b, i) => {
          const x = i * slot + slot / 2;
          const up = b.close >= b.open;
          const color = up ? "var(--color-up, #22c55e)" : "var(--color-down, #ef4444)";
          const bodyTop = y(Math.max(b.open, b.close));
          const bodyBottom = y(Math.min(b.open, b.close));
          return (
            <g
              key={b.timestamp}
              onMouseEnter={() => setHoverIndex(i)}
              onClick={() => setHoverIndex(i)}
              style={{ cursor: "crosshair" }}
            >
              <line x1={x} x2={x} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth={Math.max(1, slot * 0.08)} />
              <rect
                x={x - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={Math.max(1, bodyBottom - bodyTop)}
                fill={up ? color : color}
                fillOpacity={up ? 0.9 : 0.9}
                stroke={color}
              />
              {/* 成交量 */}
              <rect
                x={x - bodyW / 2}
                y={vy(b.volume)}
                width={bodyW}
                height={H - vy(b.volume)}
                fill={color}
                fillOpacity={0.35}
              />
            </g>
          );
        })}

        {/* 信号标记 */}
        {Array.from(markerByEvent.values()).map((mk) => {
          const selected = mk.eventId === selectedEventId;
          const common = {
            role: "button" as const,
            tabIndex: 0,
            onClick: () => onMarkerClick(mk.eventId),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onMarkerClick(mk.eventId);
              }
            },
            style: { cursor: "pointer", outline: "none" } as const,
          };
          if (mk.type === "BUY") {
            return (
              <g key={mk.eventId} {...common} aria-label={`买入信号，事件 ${mk.eventId}`}>
                <polygon
                  points={`${mk.x - 8},${mk.y + 8} ${mk.x + 8},${mk.y + 8} ${mk.x},${mk.y - 6}`}
                  fill="#22c55e"
                  stroke={selected ? "#ffffff" : "#14532d"}
                  strokeWidth={selected ? 3 : 1}
                />
                <text x={mk.x} y={mk.y + 20} textAnchor="middle" fontSize={10} fill="#22c55e">B</text>
              </g>
            );
          }
          if (mk.type === "SELL") {
            return (
              <g key={mk.eventId} {...common} aria-label={`卖出信号，事件 ${mk.eventId}`}>
                <polygon
                  points={`${mk.x - 8},${mk.y - 8} ${mk.x + 8},${mk.y - 8} ${mk.x},${mk.y + 6}`}
                  fill="#ef4444"
                  stroke={selected ? "#ffffff" : "#7f1d1d"}
                  strokeWidth={selected ? 3 : 1}
                />
                <text x={mk.x} y={mk.y - 12} textAnchor="middle" fontSize={10} fill="#ef4444">S</text>
              </g>
            );
          }
          return (
            <g key={mk.eventId} {...common} aria-label={`看跌信号（未执行），事件 ${mk.eventId}`}>
              <polygon
                points={`${mk.x},${mk.y - 8} ${mk.x + 7},${mk.y} ${mk.x},${mk.y + 8} ${mk.x - 7},${mk.y}`}
                fill="#a855f7"
                stroke={selected ? "#ffffff" : "#581c87"}
                strokeWidth={selected ? 3 : 1}
              />
              <text x={mk.x} y={mk.y - 12} textAnchor="middle" fontSize={10} fill="#a855f7">P</text>
            </g>
          );
        })}

        {/* hover 十字线 */}
        {hoverIndex !== null && hoverIndex < visible.length && (
          <line
            x1={hoverIndex * slot + slot / 2}
            x2={hoverIndex * slot + slot / 2}
            y1={0}
            y2={H}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeDasharray="4 2"
          />
        )}
      </svg>

      {/* hover OHLC 信息 */}
      {hoverBar && (
        <div className="absolute top-2 left-2 text-xs bg-card/90 border border-border rounded px-2 py-1 pointer-events-none">
          <span className="text-muted-foreground">{new Date(hoverBar.timestamp).toLocaleDateString()}</span>{" "}
          O {hoverBar.open.toFixed(2)} H {hoverBar.high.toFixed(2)} L {hoverBar.low.toFixed(2)} C{" "}
          {hoverBar.close.toFixed(2)} V {(hoverBar.volume / 1e6).toFixed(1)}M
        </div>
      )}
    </div>
  );
}
