import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema";

export function createDb(client: D1Database): DrizzleD1Database<typeof schema> {
  return drizzle(client, { schema });
}
