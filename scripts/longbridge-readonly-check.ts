/**
 * Longbridge 只读健康检查（不产生任何订单/状态变更）
 *
 * 凭据只从环境变量读取：
 *   LONGBRIDGE_ACCESS_TOKEN / LONGBRIDGE_APP_KEY / LONGBRIDGE_APP_SECRET
 *
 * 输出全部脱敏。用于验证凭据有效性与 gateway 真实连通性。
 */
import { LongbridgeGateway } from "../server/services/longbridge/gateway";
import { GatewayError } from "../server/services/longbridge/client";

async function main() {
  const gateway = new LongbridgeGateway();
  console.log("凭据已配置:", gateway.configured);
  if (!gateway.configured) {
    console.log("缺少环境变量，退出");
    process.exit(2);
  }

  let ok = 0;
  let fail = 0;

  // 1. 行情（只读）
  try {
    const quote = await gateway.getQuote("AAPL.US");
    console.log("✅ GET /v1/quote AAPL.US → lastDone =", quote.lastDone);
    ok++;
  } catch (err) {
    fail++;
    if (err instanceof GatewayError) {
      console.log(`❌ GET /v1/quote → kind=${err.kind} status=${err.opts?.status} apiCode=${err.opts?.apiCode} msg=${err.message}`);
    } else {
      console.log("❌ GET /v1/quote →", (err as Error).message);
    }
  }

  // 2. 账户资产（只读）
  try {
    const bal = await gateway.getAccountBalance();
    console.log("✅ GET /v1/asset/account → currency =", bal.currency, "| cashInfos =", bal.cashInfos.length, "个币种");
    ok++;
  } catch (err) {
    fail++;
    if (err instanceof GatewayError) {
      console.log(`❌ GET /v1/asset/account → kind=${err.kind} status=${err.opts?.status} apiCode=${err.opts?.apiCode} msg=${err.message}`);
    } else {
      console.log("❌ GET /v1/asset/account →", (err as Error).message);
    }
  }

  // 3. 今日订单（只读）
  try {
    const orders = await gateway.getTodayOrders();
    console.log("✅ GET /v1/trade/order/today →", orders.length, "笔订单");
    ok++;
  } catch (err) {
    fail++;
    if (err instanceof GatewayError) {
      console.log(`❌ GET /v1/trade/order/today → kind=${err.kind} status=${err.opts?.status} apiCode=${err.opts?.apiCode} msg=${err.message}`);
    } else {
      console.log("❌ GET /v1/trade/order/today →", (err as Error).message);
    }
  }

  console.log(`\n只读检查: ${ok} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
