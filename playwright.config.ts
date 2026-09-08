import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 配置
 * - webServer 以 paper 默认模式启动（不配置任何券商凭据 → 行情自动降级 fixture）；
 * - AUTH_* 为一次性本地测试凭据（只存 SHA-256 hash）；
 * - 数据库为本机测试实例（E2E_DATABASE_URL 由环境注入，缺省用 5433）。
 */

const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5433/ai_quant_test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3999",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3999",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "development",
      PORT: "3999",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "e2e-local-session-secret-not-a-real-secret",
      AUTH_USERNAME: "e2e",
      // sha256("e2e-password") —— 一次性本地测试凭据的哈希，非生产凭据
      AUTH_PASSWORD_HASH: "a71bc7b59280c43b37f64e49feeaf2481cda80f8a799d79031ffa12a76d288fd",
      TRADING_MODE: "paper",
      LIVE_TRADING_ENABLED: "false",
      AUTO_TRADING_ENABLED: "false",
      VITE_APP_ID: "",
      OAUTH_SERVER_URL: "",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
