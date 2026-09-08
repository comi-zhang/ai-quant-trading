/**
 * 官方 SDK 契约探针 v2（只读）：K线 + 实时报价 + 历史日期范围。
 */
import { Config, QuoteContext, Period, AdjustType, TradeSessions, NaiveDate } from "longport";

async function main() {
  const config = Config.fromEnv();
  const ctx = await QuoteContext.new(config);

  console.log("== candlesticks AAPL.US day x5 ==");
  try {
    const candles = await ctx.candlesticks("AAPL.US", Period.Day, 5, AdjustType.NoAdjust, TradeSessions.Intraday);
    console.log(`✅ ${candles.length} bars`);
    for (const c of candles.slice(0, 2)) console.log("  ", JSON.stringify(c.toJSON()));
    if (candles.length > 2) console.log("  last:", JSON.stringify(candles[candles.length - 1].toJSON()));
  } catch (err) {
    console.log("❌", (err as Error).message?.slice(0, 200));
  }

  console.log("\n== historyCandlesticksByDate 2026-08-01..2026-08-15 ==");
  try {
    const candles = await ctx.historyCandlesticksByDate(
      "AAPL.US",
      Period.Day,
      AdjustType.NoAdjust,
      new NaiveDate(2026, 8, 1),
      new NaiveDate(2026, 8, 15),
      TradeSessions.Intraday
    );
    console.log(`✅ ${candles.length} bars`);
    for (const c of candles.slice(0, 2)) console.log("  ", JSON.stringify(c.toJSON()));
    if (candles.length > 2) console.log("  last:", JSON.stringify(candles[candles.length - 1].toJSON()));
  } catch (err) {
    console.log("❌", (err as Error).message?.slice(0, 200));
  }

  console.log("\n== realtimeQuote AAPL.US ==");
  try {
    const quotes = await ctx.realtimeQuote(["AAPL.US"]);
    console.log(`✅ ${quotes.length} quotes`);
    console.log("  ", JSON.stringify(quotes[0]?.toJSON()).slice(0, 400));
  } catch (err) {
    console.log("❌", (err as Error).message?.slice(0, 200));
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
