import { z } from "zod";

/**
 * 分层环境变量校验：
 * - test:    全部外部凭据可选（使用 mock/fixture）
 * - development: 数据库可选，其余 warn
 * - production: 关键凭据必须存在，live 开关必须显式
 *
 * 任何情况下都不得在此文件中写入真实 secret 的默认值。
 */

const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v.toLowerCase() === "true"));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  VITE_APP_ID: z.string().default(""),
  JWT_SECRET: z.string().default(""),
  DATABASE_URL: z.string().default(""),
  OAUTH_SERVER_URL: z.string().default(""),
  OWNER_OPEN_ID: z.string().default(""),

  // 简单登录（单用户模式）。密码只接受 SHA-256 hash，禁止明文。
  AUTH_USERNAME: z.string().default(""),
  AUTH_PASSWORD_HASH: z.string().default(""),

  BUILT_IN_FORGE_API_URL: z.string().default(""),
  BUILT_IN_FORGE_API_KEY: z.string().default(""),

  LONGBRIDGE_ACCESS_TOKEN: z.string().default(""),
  LONGBRIDGE_APP_KEY: z.string().default(""),
  LONGBRIDGE_APP_SECRET: z.string().default(""),
  LONGBRIDGE_HTTP_URL: z.string().default("https://openapi.longportapp.com"),

  GEMINI_API_URL: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  NEWS_API_KEY: z.string().default(""),
  ALPHA_VANTAGE_API_KEY: z.string().default(""),

  // 交易模式闸门：默认 paper，禁止 live / 自动交易
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  LIVE_TRADING_ENABLED: boolFromEnv(false),
  AUTO_TRADING_ENABLED: boolFromEnv(false),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // 不打印任何环境变量值，只打印字段名
  const fields = parsed.error.issues.map((i) => i.path.join("."));
  throw new Error(`[ENV] Invalid environment configuration: ${fields.join(", ")}`);
}
const e = parsed.data;

export const ENV = {
  appId: e.VITE_APP_ID,
  cookieSecret: e.JWT_SECRET,
  databaseUrl: e.DATABASE_URL,
  oAuthServerUrl: e.OAUTH_SERVER_URL,
  ownerOpenId: e.OWNER_OPEN_ID,
  isProduction: e.NODE_ENV === "production",
  isTest: e.NODE_ENV === "test",
  authUsername: e.AUTH_USERNAME,
  authPasswordHash: e.AUTH_PASSWORD_HASH,
  forgeApiUrl: e.BUILT_IN_FORGE_API_URL,
  forgeApiKey: e.BUILT_IN_FORGE_API_KEY,
  longbridgeAccessToken: e.LONGBRIDGE_ACCESS_TOKEN,
  longbridgeAppKey: e.LONGBRIDGE_APP_KEY,
  longbridgeAppSecret: e.LONGBRIDGE_APP_SECRET,
  longbridgeHttpUrl: e.LONGBRIDGE_HTTP_URL,
  geminiApiUrl: e.GEMINI_API_URL,
  geminiApiKey: e.GEMINI_API_KEY,
  newsApiKey: e.NEWS_API_KEY,
  alphaVantageApiKey: e.ALPHA_VANTAGE_API_KEY,
  tradingMode: e.TRADING_MODE,
  liveTradingEnabled: e.LIVE_TRADING_ENABLED,
  autoTradingEnabled: e.AUTO_TRADING_ENABLED,
} as const;

export type TradingMode = typeof ENV.tradingMode;

/** Longbridge 凭据是否齐全（不暴露值） */
export function hasLongbridgeCredentials(): boolean {
  return Boolean(
    ENV.longbridgeAccessToken && ENV.longbridgeAppKey && ENV.longbridgeAppSecret
  );
}

// 生产环境的硬性要求：只警告字段名，不打印值
if (ENV.isProduction) {
  const required: (keyof typeof ENV)[] = ["cookieSecret", "databaseUrl"];
  const missing = required.filter((k) => !ENV[k]);
  if (missing.length > 0) {
    console.warn(`[ENV] Missing required production env vars: ${missing.join(", ")}`);
  }
  if (ENV.liveTradingEnabled && ENV.tradingMode !== "live") {
    console.warn("[ENV] LIVE_TRADING_ENABLED=true 但 TRADING_MODE!=live，live 交易仍被禁用");
  }
}
