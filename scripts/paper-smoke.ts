/**
 * Paper 冒烟测试（只读 + 本地模拟，绝不触碰真实资金）
 *
 * 验证从全新数据库开始的完整闭环：
 * 迁移 → 用户 → paper 下单 → 成交入账 → 持仓/现金/审计 → 幂等 → 撤单
 *
 * 运行: pnpm smoke:paper
 * 使用 PGlite（WASM PostgreSQL）临时实例，不依赖外部数据库/网络/凭据。
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import { users, orders, positions, accountCash, auditEvents } from "../drizzle/schema";
import type { Db } from "../server/db";
import { OrderService } from "../server/services/orderService";
import type { LongbridgeGateway } from "../server/services/longbridge/gateway";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("=== Paper Smoke Test（无网络/无真实凭据/无真实订单）===\n");

  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as Db;

  // 1. 迁移
  await migrate(db as never, { migrationsFolder: "drizzle" });
  check("数据库迁移（up）在全新实例上成功", true);

  // 2. 用户
  const [user] = await db.insert(users).values({ openId: "smoke-user", name: "smoke" }).returning();
  check("创建用户", Boolean(user));

  // 3. paper 下单（假 gateway 提供参考价，无网络）
  const fakeGateway = {
    configured: true,
    getQuote: async (symbol: string) => ({
      symbol, lastDone: 100, prevClose: 99, open: 99.5, high: 101, low: 98.5, volume: 1, turnover: 1,
    }),
  } as unknown as LongbridgeGateway;

  const service = new OrderService({ db, gateway: fakeGateway });

  const buy = await service.submitOrder({
    userId: user.id, symbol: "AAPL", side: "buy", orderType: "market",
    quantity: 10, timeInForce: "day", clientOrderId: "smoke-cid-1",
  });
  check("paper 市价买单成交", buy.status === "filled" && buy.mode === "paper", buy.message);

  const dup = await service.submitOrder({
    userId: user.id, symbol: "AAPL", side: "buy", orderType: "market",
    quantity: 10, timeInForce: "day", clientOrderId: "smoke-cid-1",
  });
  check("幂等：重复请求去重", dup.duplicate === true);

  const pos = await db.select().from(positions);
  check("持仓入账", pos.length === 1 && Number(pos[0].quantity) === 10, `qty=${pos[0]?.quantity}`);

  const cash = await db.select().from(accountCash);
  check("现金扣减", Number(cash[0].cash) === 99000, `cash=${cash[0]?.cash}`);

  const audit = await db.select().from(auditEvents);
  check("审计事件已记录", audit.some((a) => a.eventType === "order.filled"));

  // 4. 风控拒绝（超大单）
  const big = await service.submitOrder({
    userId: user.id, symbol: "AAPL", side: "buy", orderType: "market",
    quantity: 100000, timeInForce: "day", clientOrderId: "smoke-cid-2",
  });
  check("风控拒绝超限订单", big.status === "rejected", big.risk.violations[0]);

  // 5. 限价单 + 撤单
  const limit = await service.submitOrder({
    userId: user.id, symbol: "AAPL", side: "buy", orderType: "limit",
    quantity: 5, limitPrice: 90, timeInForce: "gtc", clientOrderId: "smoke-cid-3",
  });
  check("价外限价单保持 accepted", limit.status === "accepted");
  const cancel = await service.cancelOrder({ userId: user.id, orderId: limit.id! });
  check("paper 撤单成功", cancel.success && cancel.status === "cancelled");

  // 6. live 守卫：默认配置下绝不执行真实下单
  const { isLiveMode, assertLiveTradingAllowed } = await import("../server/services/tradingMode");
  let guardOk = false;
  try {
    assertLiveTradingAllowed("smoke");
  } catch {
    guardOk = true;
  }
  check("live 交易默认被拒绝（双开关）", !isLiveMode() && guardOk);

  const orderCount = await db.select().from(orders);
  // 3 笔：成交 1 + 拒绝 1 + 撤销 1（去重的重复请求不产生新订单）
  check("订单总数符合预期（3 笔：成交/拒绝/撤销，去重不落库）", orderCount.length === 3, `count=${orderCount.length}`);

  await pg.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("SMOKE TEST 崩溃:", err);
  process.exit(1);
});
