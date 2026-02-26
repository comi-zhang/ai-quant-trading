export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenID: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  longbridgeAccessToken: process.env.LONGBRIDGE_ACCESS_TOKEN ?? "",
  longbridgeAppKey: process.env.LONGBRIDGE_APP_KEY ?? "",
  longbridgeAppSecret: process.env.LONGBRIDGE_APP_SECRET ?? "",
  geminiApiUrl: process.env.GEMINI_API_URL ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  newsApiKey: process.env.NEWS_API_KEY ?? "",
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY ?? "",
} as const;

// 环境变量验证
const requiredEnvVars: (keyof typeof ENV)[] = [];
const missingEnvVars = requiredEnvVars.filter((key) => !ENV[key]);

if (missingEnvVars.length > 0 && ENV.isProduction) {
  console.warn(`[ENV] Missing environment variables: ${missingEnvVars.join(", ")}`);
}
