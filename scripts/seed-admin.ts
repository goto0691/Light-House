import { ulid } from "ulidx";

type SeedAdminConfig = {
  email: string;
  displayName: string;
  timezone: string;
  locale: string;
};

function getConfig(): SeedAdminConfig {
  return {
    email: process.env.LIGHT_HOUSE_ADMIN_EMAIL ?? "keeper@lighthouse.local",
    displayName: process.env.LIGHT_HOUSE_ADMIN_NAME ?? "Light Keeper",
    timezone: process.env.LIGHT_HOUSE_ADMIN_TIMEZONE ?? "Asia/Seoul",
    locale: process.env.LIGHT_HOUSE_ADMIN_LOCALE ?? "ko-KR",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function escapeSql(value: string) {
  return value.replaceAll("'", "''");
}

function buildInsertSql(config: SeedAdminConfig) {
  const id = ulid();
  const timestamp = nowIso();

  return `INSERT INTO users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
VALUES (
  '${id}',
  '${escapeSql(config.email)}',
  '${escapeSql(config.displayName)}',
  '${escapeSql(config.locale)}',
  '${escapeSql(config.timezone)}',
  '{"theme":"dark"}',
  '${timestamp}',
  '${timestamp}'
);`;
}

const config = getConfig();

console.log("-- Project Light House admin seed");
console.log("-- Copy the SQL below after your first D1 migration is applied.");
console.log(buildInsertSql(config));
