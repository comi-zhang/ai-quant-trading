import { z } from "zod";
import type { HistoryBar, Period } from "./types";

/**
 * 历史数据规范化：schema 校验 → 数值解析 → 时间排序 → 去重 →
 * 缺口检测 → 异常价格检测 → 时区归一 → 数量上限。
 *
 * 原则：坏 bar 丢弃并计数警告，绝不用 0/固定价格补齐。
 */

const rawBarSchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  open: z.union([z.string(), z.number()]),
  high: z.union([z.string(), z.number()]),
  low: z.union([z.string(), z.number()]),
  close: z.union([z.string(), z.number()]),
  volume: z.union([z.string(), z.number()]),
  turnover: z.union([z.string(), z.number()]).optional(),
});

export interface NormalizeResult {
  bars: HistoryBar[];
  warnings: string[];
  dropped: number;
  truncated: boolean;
}

function toNum(v: string | number): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function toIsoUtc(v: string | number): string | null {
  const d = typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 日/周/月K的最大允许相邻间隔（自然日）；超过视为缺口 */
const GAP_DAYS: Record<Period, number> = { day: 4, week: 10, month: 35 };

export function normalizeBars(raw: unknown[], opts: { period: Period; maxBars: number }): NormalizeResult {
  const warnings: string[] = [];
  let dropped = 0;
  const parsed: HistoryBar[] = [];

  for (const item of raw) {
    const r = rawBarSchema.safeParse(item);
    if (!r.success) {
      dropped++;
      continue;
    }
    const b = r.data;
    const timestamp = toIsoUtc(b.timestamp);
    const open = toNum(b.open);
    const high = toNum(b.high);
    const low = toNum(b.low);
    const close = toNum(b.close);
    const volume = toNum(b.volume);
    const turnover = b.turnover !== undefined ? toNum(b.turnover) : null;

    // 异常价格检测
    if (
      timestamp === null ||
      open === null || high === null || low === null || close === null || volume === null ||
      open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
      high < low || volume < 0
    ) {
      dropped++;
      continue;
    }
    parsed.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      ...(turnover !== null ? { turnover } : {}),
    });
  }
  if (dropped > 0) {
    warnings.push(`${dropped} 条无效/异常 bar 已丢弃`);
  }

  // 时间升序
  parsed.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // 重复 bar 去除（保留第一条）
  const deduped: HistoryBar[] = [];
  let dupCount = 0;
  for (const b of parsed) {
    if (deduped.length > 0 && deduped[deduped.length - 1].timestamp === b.timestamp) {
      dupCount++;
      continue;
    }
    deduped.push(b);
  }
  if (dupCount > 0) {
    warnings.push(`${dupCount} 条重复时间戳 bar 已去除`);
  }

  // 缺口检测
  const maxGapMs = GAP_DAYS[opts.period] * 24 * 3600 * 1000;
  let gapCount = 0;
  for (let i = 1; i < deduped.length; i++) {
    const prev = new Date(deduped[i - 1].timestamp).getTime();
    const cur = new Date(deduped[i].timestamp).getTime();
    if (cur - prev > maxGapMs) gapCount++;
  }
  if (gapCount > 0) {
    warnings.push(`检测到 ${gapCount} 处时间缺口（可能存在停牌/缺数据区间）`);
  }

  // 数量上限
  let truncated = false;
  let bars = deduped;
  if (deduped.length > opts.maxBars) {
    bars = deduped.slice(deduped.length - opts.maxBars);
    truncated = true;
    warnings.push(`数据量超过上限，仅保留最近 ${opts.maxBars} 条`);
  }

  return { bars, warnings, dropped, truncated };
}
