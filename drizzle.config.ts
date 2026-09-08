import { defineConfig } from "drizzle-kit";

// generate 不需要数据库连接；migrate/push 时才要求 DATABASE_URL
const connectionString = process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
