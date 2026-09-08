/**
 * 契约探针（只读）：验证行情/K线 REST 路径与响应结构。
 * 凭据只从环境变量读取；输出为结构摘要（键名/类型/条数），不打印敏感值。
 */
import { LongbridgeClient } from "../server/services/longbridge/client";

const client = new LongbridgeClient();

function summarize(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return { array: v.length, sample: v.slice(0, 2).map((x) => summarize(x, depth + 1)) };
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = depth >= 2 ? typeof val : summarize(val, depth + 1);
    }
    return out;
  }
  return typeof v;
}

async function probe(name: string, fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    console.log(`✅ ${name}`);
    console.log(JSON.stringify(summarize(data), null, 1).slice(0, 1600));
  } catch (err) {
    console.log(`❌ ${name} → ${(err as Error).message.slice(0, 150)}`);
  }
  console.log("---");
}

async function main() {
  await probe("POST /v1/quote (multi)", () =>
    client.request({ method: "POST", path: "/v1/quote", body: { symbols: ["AAPL.US"] } })
  );
  await probe("GET /v1/quote/candlesticks day", () =>
    client.request({
      method: "GET",
      path: "/v1/quote/candlesticks",
      query: { symbol: "AAPL.US", period: "day", count: 5, adjust_type: "no_adjust" },
    })
  );
  await probe("GET /v1/quote/history_candlesticks day", () =>
    client.request({
      method: "GET",
      path: "/v1/quote/history_candlesticks",
      query: {
        symbol: "AAPL.US",
        period: "day",
        adjust_type: "no_adjust",
        start_time: "2026-08-01T00:00:00Z",
        end_time: "2026-08-10T00:00:00Z",
      },
    })
  );
}

main();
