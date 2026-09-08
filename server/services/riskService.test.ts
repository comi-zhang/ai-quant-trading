import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../drizzle/schema";
import { users } from "../../drizzle/schema";

/**
 * riskService 持久化测试：默认值、更新+版本号、kill switch。
 * 通过注入 DATABASE_URL 到 PGlite 不可行（PGlite 无 TCP），
 * 因此直接对 drizzle 实例验证等价 SQL 行为——本测试聚焦 schema/迁移语义，
 * riskService 的 getDb 路径由 orderService 集成测试间接覆盖。
 */

let pg: PGlite;
let db: ReturnType<typeof drizzle>;
let userId: number;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db as never, { migrationsFolder: "drizzle" });
  const [u] = await db.insert(users).values({ openId: "risk-user", name: "t" }).returning();
  userId = u.id;
}, 60000);

afterAll(async () => {
  await pg.close();
});

describe("risk_config 持久化", () => {
  it("创建默认配置", async () => {
    const [row] = await db
      .insert(schema.riskConfig)
      .values({
        userId,
        maxPositionSize: "10000",
        maxTotalExposure: "50000",
        stopLossPercent: "2",
        takeProfitPercent: "5",
      })
      .returning();
    expect(row.maxDailyTrades).toBe(20); // integer 默认值（原 serial bug 已修复）
    expect(row.maxOrderQuantity).toBe(1000);
    expect(row.tradingHalted).toBe(false);
    expect(row.version).toBe(1);
    expect(Number(row.maxDailyLoss)).toBe(2000);
  });

  it("userId 唯一约束", async () => {
    await expect(
      db.insert(schema.riskConfig).values({
        userId,
        maxPositionSize: "1",
        maxTotalExposure: "1",
        stopLossPercent: "1",
        takeProfitPercent: "1",
      })
    ).rejects.toThrow();
  });

  it("版本号递增更新", async () => {
    const { eq } = await import("drizzle-orm");
    const [updated] = await db
      .update(schema.riskConfig)
      .set({ maxDailyTrades: 5, version: 2 })
      .where(eq(schema.riskConfig.userId, userId))
      .returning();
    expect(updated.version).toBe(2);
    expect(updated.maxDailyTrades).toBe(5);
  });

  it("kill switch 状态持久化", async () => {
    const { eq } = await import("drizzle-orm");
    const [halted] = await db
      .update(schema.riskConfig)
      .set({ tradingHalted: true, haltReason: "测试" })
      .where(eq(schema.riskConfig.userId, userId))
      .returning();
    expect(halted.tradingHalted).toBe(true);
    expect(halted.haltReason).toBe("测试");
  });
});
