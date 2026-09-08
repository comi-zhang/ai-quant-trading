import { createHash } from "crypto";
import type { DataSource, HistoryDataSet, HistoryQuery, Period, QualityStatus } from "./types";
import { MAX_BARS } from "./types";
import { normalizeBars } from "./normalize";
import { FixtureProvider, LongportSdkProvider, type HistoryProvider } from "./provider";
import { normalizeSymbol, symbolMarket } from "../longbridge/contract";
import { hasLongbridgeCredentials } from "../../_core/env";

/**
 * 历史数据服务：provider 选择 + 规范化 + 缓存（带数据版本与 TTL）。
 *
 * 数据源选择规则：
 * - 显式 source=fixture → fixture；
 * - 显式 source=longbridge 或默认：有凭据用 SDK，无凭据降级 fixture 并记录警告；
 * - longbridge 拉取失败：不静默换源，直接抛错（由路由层返回明确错误状态）。
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: HistoryDataSet;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearHistoryCache(): void {
  cache.clear();
}

function cacheKey(q: { source: DataSource; symbol: string; period: Period; startTime: string; endTime: string }): string {
  return `${q.source}|${q.symbol}|${q.period}|${q.startTime}|${q.endTime}`;
}

function dataVersionOf(bars: { timestamp: string; close: number }[]): string {
  const h = createHash("sha256");
  for (const b of bars) h.update(`${b.timestamp}:${b.close}|`);
  return h.digest("hex").slice(0, 12);
}

export interface HistoryServiceDeps {
  longbridgeProvider?: HistoryProvider;
  fixtureProvider?: HistoryProvider;
  now?: () => number;
}

export class HistoryService {
  private readonly lb?: HistoryProvider;
  private readonly fixture: HistoryProvider;
  private readonly now: () => number;

  constructor(deps: HistoryServiceDeps = {}) {
    this.lb = deps.longbridgeProvider ?? (hasLongbridgeCredentials() ? new LongportSdkProvider() : undefined);
    this.fixture = deps.fixtureProvider ?? new FixtureProvider();
    this.now = deps.now ?? (() => Date.now());
  }

  async getHistory(query: HistoryQuery): Promise<HistoryDataSet> {
    const symbol = normalizeSymbol(query.symbol);
    const market = symbolMarket(symbol);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);

    const requestedSource: DataSource =
      query.source ?? (this.lb ? "longbridge" : "fixture");

    const key = cacheKey({ source: requestedSource, symbol, period: query.period, startTime: query.startTime, endTime: query.endTime });
    const cached = cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.data;
    }

    const provider = requestedSource === "longbridge" ? this.lb : this.fixture;
    if (!provider) {
      throw new Error(`数据源 ${requestedSource} 不可用（缺少凭据或 provider）`);
    }

    const raw = await provider.fetchCandles({
      symbol,
      period: query.period,
      startTime,
      endTime,
      maxBars: MAX_BARS,
    });

    const { bars, warnings, truncated } = normalizeBars(raw, { period: query.period, maxBars: MAX_BARS });

    if (bars.length === 0) {
      warnings.push("所选时间范围内无数据");
    }

    const qualityStatus: QualityStatus =
      bars.length === 0 ? "degraded" : warnings.length > 0 ? "partial" : "ok";

    const data: HistoryDataSet = {
      symbol,
      market,
      period: query.period,
      bars,
      source: provider.name,
      fetchedAt: new Date(this.now()).toISOString(),
      timezone: "UTC",
      dataVersion: dataVersionOf(bars),
      qualityStatus,
      warnings,
      actualRange:
        bars.length > 0
          ? { start: bars[0].timestamp, end: bars[bars.length - 1].timestamp }
          : null,
    };

    // 截断数据缩短缓存时间（可能仍在更新）；空结果不缓存
    if (bars.length > 0) {
      cache.set(key, {
        data,
        expiresAt: this.now() + (truncated ? CACHE_TTL_MS / 5 : CACHE_TTL_MS),
      });
    }
    return data;
  }
}

let _default: HistoryService | null = null;
export function getHistoryService(): HistoryService {
  _default ??= new HistoryService();
  return _default;
}
export function resetHistoryService(): void {
  _default = null;
  clearHistoryCache();
}
