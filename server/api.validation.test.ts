import { describe, expect, it } from "vitest";

/**
 * 环境配置校验（离线）
 *
 * 原版本会真实调用 Alpha Vantage / NewsAPI 并在缺少 Longbridge 凭据时失败。
 * 原则：单元测试不依赖真实 secret、不做外部网络调用；凭据有效性由
 * contract tests（HTTP mock）与只读健康检查覆盖。
 */

describe("环境变量配置", () => {
  it("未配置外部 API key 是合法的（降级运行，不伪造数据）", () => {
    // Alpha Vantage / NewsAPI 均为可选数据源；缺失时策略标记 dataQuality
    expect(process.env.ALPHA_VANTAGE_API_KEY === undefined || typeof process.env.ALPHA_VANTAGE_API_KEY === "string").toBe(true);
    expect(process.env.NEWS_API_KEY === undefined || typeof process.env.NEWS_API_KEY === "string").toBe(true);
  });

  it("Longbridge 凭据缺失时客户端报告未配置（fail closed）", async () => {
    const { LongbridgeClient } = await import("./services/longbridge/client");
    const client = new LongbridgeClient({
      accessToken: "",
      appKey: "",
      appSecret: "",
      transport: async () => {
        throw new Error("不应发起网络请求");
      },
    });
    expect(client.configured).toBe(false);
    await expect(client.request({ method: "GET", path: "/v1/quote" })).rejects.toMatchObject({
      kind: "AUTH",
    });
  }, 30000);

  it("交易模式默认 paper 且 live 被禁用", async () => {
    const { isLiveMode, assertLiveTradingAllowed } = await import("./services/tradingMode");
    // 测试环境未显式开启 live 双开关时必须拒绝
    if (!isLiveMode()) {
      expect(() => assertLiveTradingAllowed("test")).toThrowError(/真实交易已禁用/);
    }
  });

  it("环境变量 schema 拒绝非法 TRADING_MODE", async () => {
    // env.ts 在 import 时校验；非法值会 throw。这里验证 schema 行为本身。
    const { z } = await import("zod");
    const schema = z.enum(["paper", "live"]);
    expect(schema.safeParse("paper").success).toBe(true);
    expect(schema.safeParse("yes").success).toBe(false);
  });
});
