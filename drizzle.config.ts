import type { Config } from "drizzle-kit";

export default {
  schema: "./packages/db/schema/*.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID ?? "",
    token: process.env.DATABASE_AUTH_TOKEN ?? "",
  },
} satisfies Config;
