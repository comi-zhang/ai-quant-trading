/**
 * fixture 抓取（只读）：将真实历史K线固化为本地 fixture，用于离线测试/E2E。
 * 保存的是公开市场行情数据（OHLCV），不含任何凭据或账户信息。
 */
import { Config, QuoteContext, Period, AdjustType, TradeSessions } from "longport";
import { writeFileSync, mkdirSync } from "fs";

async function main() {
  const config = Config.fromEnv();
  const ctx = await QuoteContext.new(config);

  const targets = [
    { symbol: "AAPL.US", count: 120 },
    { symbol: "MSFT.US", count: 120 },
  ];

  mkdirSync("server/services/history/fixtures", { recursive: true });

  for (const t of targets) {
    const candles = await ctx.candlesticks(t.symbol, Period.Day, t.count, AdjustType.NoAdjust, TradeSessions.Intraday);
    const bars = candles.map((c) => {
      const j = c.toJSON() as Record<string, unknown>;
      return {
        timestamp: j.timestamp,
        open: j.open,
        high: j.high,
        low: j.low,
        close: j.close,
        volume: j.volume,
        turnover: j.turnover,
      };
    });
    const payload = {
      symbol: t.symbol,
      market: t.symbol.split(".")[1],
      period: "day",
      adjustType: "no_adjust",
      capturedAt: new Date().toISOString(),
      note: "Longbridge OpenAPI 真实历史日K（公开行情数据，无凭据/账户信息）",
      bars,
    };
    const path = `server/services/history/fixtures/${t.symbol}.day.json`;
    writeFileSync(path, JSON.stringify(payload, null, 2));
    console.log(`✅ ${t.symbol}: ${bars.length} bars → ${path}`);
    console.log(`   range: ${bars[0]?.timestamp} .. ${bars[bars.length - 1]?.timestamp}`);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
