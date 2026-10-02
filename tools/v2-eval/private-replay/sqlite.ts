import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

class LocalStatement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { return (this.statement.get(...this.values) ?? null) as T | null; }
  async all<T>() { return { results: this.statement.all(...this.values) as T[] }; }
  async run() { return this.statement.run(...this.values); }
}

/** Isolated in-memory SQLite and actual migrations/SQL. No remote or existing database path exists. */
export class PrivateReplaySqlite implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  constructor(readonly ownerId: string) {
    this.sql.exec("pragma foreign_keys=on; create table users(id text primary key not null);");
    this.sql.prepare("insert into users(id) values (?)").run(ownerId);
    const directory = fileURLToPath(new URL("../../../migrations/", import.meta.url));
    const migrations = readdirSync(directory).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort();
    if (migrations.length !== 27) throw new Error("PRIVATE_REPLAY_SCHEMA_INVALID");
    for (const name of migrations) this.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));
  }
  prepare(query: string) { return new LocalStatement(this.sql.prepare(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.sql.exec("begin immediate");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sql.exec("commit");
      return results as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
  close() { this.sql.close(); }
}
