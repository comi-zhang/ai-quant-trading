import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Period } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 历史数据 Provider（双源）：
 * - LongportSdkProvider：官方 SDK（WS），真实历史K线；
 * - FixtureProvider：本地 fixture（真实抓取固化的 JSON）+ 确定性合成序列兜底。
 *
 * SDK 为可选依赖（native binding），未安装/未配置凭据时 provider 抛错，
 * 由上层决定降级到 fixture 或返回错误状态，绝不静默伪造"真实数据"。
 */

export interface RawCandle {
  timestamp: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  turnover?: string | number;
}

export interface HistoryProvider {
  readonly name: "longbridge" | "fixture";
  fetchCandles(input: {
    symbol: string;
    period: Period;
    startTime: Date;
    endTime: Date;
    maxBars: number;
  }): Promise<RawCandle[]>;
}

// ---------- Longbridge 官方 SDK Provider ----------

/** SDK QuoteContext 的最小结构接口（避免依赖 napi 类型的 const enum 问题） */
interface SdkQuoteContext {
  historyCandlesticksByDate(
    symbol: string,
    period: never,
    adjustType: never,
    start: unknown,
    end: unknown,
    tradeSessions: never
  ): Promise<{ toJSON(): unknown }[]>;
}

const SDK_PERIOD: Record<Period, string> = { day: "Day", week: "Week", month: "Month" };

export class LongportSdkProvider implements HistoryProvider {
  readonly name = "longbridge" as const;
  private ctxPromise: Promise<SdkQuoteContext> | null = null;

  private async getCtx(): Promise<SdkQuoteContext> {
    if (!this.ctxPromise) {
      this.ctxPromise = (async () => {
        const sdk = await import("longport");
        const config = sdk.Config.fromEnv();
        const ctx = await sdk.QuoteContext.new(config);
        return ctx as unknown as SdkQuoteContext;
      })();
    }
    return this.ctxPromise;
  }

  async fetchCandles(input: {
    symbol: string;
    period: Period;
    startTime: Date;
    endTime: Date;
    maxBars: number;
  }): Promise<RawCandle[]> {
    const sdk = await import("longport");
    const ctx = await this.getCtx();
    // SDK 的 Period/AdjustType/TradeSessions 在 .d.ts 中为 const enum，
    // 运行时是普通对象；经模块对象索引访问以兼容 isolatedModules
    const runtime = sdk as unknown as Record<string, Record<string, number>>;
    const period = runtime.Period[SDK_PERIOD[input.period]];
    const adjust = runtime.AdjustType.NoAdjust;
    const session = runtime.TradeSessions.Intraday;

    const start = new sdk.NaiveDate(
      input.startTime.getUTCFullYear(),
      input.startTime.getUTCMonth() + 1,
      input.startTime.getUTCDate()
    );
    const end = new sdk.NaiveDate(
      input.endTime.getUTCFullYear(),
      input.endTime.getUTCMonth() + 1,
      input.endTime.getUTCDate()
    );

    const candles = await ctx.historyCandlesticksByDate(
      input.symbol,
      period as never,
      adjust as never,
      start,
      end,
      session as never
    );
    return candles.map((c) => c.toJSON() as unknown as RawCandle);
  }
}

// ---------- Fixture Provider ----------

interface FixtureFile {
  symbol: string;
  period: string;
  bars: RawCandle[];
}

/** 确定性伪随机（mulberry32），合成 fixture 专用，结果可复现 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromSymbol(symbol: string): number {
  let h = 2166136261;
  for (const c of symbol) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** 合成日K（随机游走，确定性）：仅当无真实 fixture 时兜底，source 永远标记 fixture */
export function generateSyntheticBars(symbol: string, startTime: Date, endTime: Date): RawCandle[] {
  const rand = mulberry32(seedFromSymbol(symbol));
  const bars: RawCandle[] = [];
  let price = 50 + rand() * 200;
  const startDay = Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate());
  const endDay = Date.UTC(endTime.getUTCFullYear(), endTime.getUTCMonth(), endTime.getUTCDate());

  for (let d = startDay; d <= endDay; d += 24 * 3600 * 1000) {
    const date = new Date(d);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue; // 跳过周末，贴近真实交易日
    const drift = (rand() - 0.48) * 0.04;
    const open = price;
    const close = Math.max(1, open * (1 + drift));
    const high = Math.max(open, close) * (1 + rand() * 0.01);
    const low = Math.min(open, close) * (1 - rand() * 0.01);
    const volume = Math.floor(1_000_000 + rand() * 50_000_000);
    bars.push({
      timestamp: date.toISOString(),
      open: open.toFixed(3),
      high: high.toFixed(3),
      low: low.toFixed(3),
      close: close.toFixed(3),
      volume,
      turnover: (volume * close).toFixed(2),
    });
    price = close;
  }
  return bars;
}

export class FixtureProvider implements HistoryProvider {
  readonly name = "fixture" as const;
  constructor(private readonly fixturesDir: string = join(HERE, "fixtures")) {}

  private loadFixture(symbol: string, period: Period): FixtureFile | null {
    const path = join(this.fixturesDir, `${symbol}.${period}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
    } catch {
      return null;
    }
  }

  async fetchCandles(input: {
    symbol: string;
    period: Period;
    startTime: Date;
    endTime: Date;
  }): Promise<RawCandle[]> {
    const fixture = this.loadFixture(input.symbol, input.period);
    if (fixture) {
      const startMs = input.startTime.getTime();
      const endMs = input.endTime.getTime() + 24 * 3600 * 1000; // endTime 当日 inclusive
      return fixture.bars.filter((b) => {
        const t = new Date(b.timestamp).getTime();
        return t >= startMs && t < endMs;
      });
    }
    if (input.period !== "day") {
      throw new Error(`fixture 无 ${input.symbol} 的 ${input.period} 数据（合成仅支持 day）`);
    }
    return generateSyntheticBars(input.symbol, input.startTime, input.endTime);
  }
}
