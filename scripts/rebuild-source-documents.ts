import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Result<T> = { meta?: { changes?: number }; results?: T[]; success?: boolean };
type D1Envelope<T> = { errors?: Array<{ message?: string }>; result?: Array<D1Result<T>>; success?: boolean };

type Row = Record<string, unknown>;

const ENTITY_CONFIGS = [
  {
    table: "zettels",
    entityType: "zettel",
    sourceDatabase: "Vault",
    titleColumn: "title",
    role: (row: Row) => String(row.type ?? row.category ?? "note"),
    preview: (row: Row) => String(row.summary ?? row.content_text ?? row.content ?? "").slice(0, 600),
    properties: ["type", "category", "source", "source_url", "pinned"],
  },
  {
    table: "media_logs",
    entityType: "media",
    sourceDatabase: "Media",
    titleColumn: "title",
    role: (row: Row) => String(row.media_type ?? "media"),
    preview: (row: Row) => String(row.evaluation ?? row.review ?? row.content ?? "").slice(0, 600),
    properties: ["media_type", "original_title", "platform_or_publisher", "creator", "studio", "genre", "status", "rating", "evaluation", "review", "play_time", "author", "completed_at"],
  },
  {
    table: "people",
    entityType: "person",
    sourceDatabase: "PRM",
    titleColumn: "name",
    role: (row: Row) => (Number(row.is_favorite ?? 0) ? "favorite-person" : "person"),
    preview: (row: Row) => String(row.bio ?? row.core_value ?? "").slice(0, 600),
    properties: ["nickname", "birth_date", "groups", "bio", "phone", "email", "address", "core_value", "last_contacted_at", "status", "is_favorite"],
  },
  {
    table: "daily_logs",
    entityType: "daily_log",
    sourceDatabase: "Life Ops",
    titleColumn: "date",
    role: () => "daily-log",
    preview: (row: Row) => String(row.journal ?? row.meditation ?? row.gratitude ?? "").slice(0, 600),
    properties: ["date", "mood", "energy_level", "emotions", "gratitude", "journal", "meditation", "meditation_verse"],
  },
  {
    table: "workouts",
    entityType: "workout",
    sourceDatabase: "Life Ops",
    titleColumn: "date",
    role: () => "workout",
    preview: (row: Row) => String(row.notes ?? row.categories ?? "").slice(0, 600),
    properties: ["date", "categories", "duration_minutes", "intensity", "notes"],
  },
] as const;

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.trim().match(/^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/);
      if (!match) continue;
      process.env[match[1]] ??= match[2].replace(/^"|"$/g, "");
    }
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function sourceDocId(userId: string, entityType: string, entityId: string) {
  const hash = createHash("sha1").update(`${userId}:${entityType}:${entityId}`).digest("hex").slice(0, 26);
  return `src_${hash}`;
}

function normalize(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  return String(value);
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${requiredEnv("CLOUDFLARE_D1_DATABASE_ID")}/query`;
  const token = process.env.CLOUDFLARE_API_TOKEN ?? requiredEnv("DATABASE_AUTH_TOKEN");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const payload = (await response.json()) as D1Envelope<T>;
  const result = payload.result?.[0];
  if (!response.ok || payload.success === false || result?.success === false) {
    const message = payload.errors?.map((error) => error.message).join(" | ") || "D1 query failed.";
    throw new Error(`${message}\n${sql.slice(0, 200)}`);
  }
  return result?.results ?? [];
}

async function exec(sql: string, params: unknown[] = []) {
  await queryD1(sql, params);
}

async function bulkInsert(table: string, columns: string[], rows: unknown[][], suffix = "", chunkSize = 10) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    await exec(`insert into ${table} (${columns.join(", ")}) values ${placeholders} ${suffix}`, chunk.flat());
  }
}

function inferSourceId(row: Row, entityType: string) {
  return normalize(row.notion_source_id) ?? normalize(row.id) ?? `${entityType}:${randomUUID()}`;
}

async function rebuild() {
  loadEnv();
  const user = (await queryD1<{ id: string }>("select id from users limit 1"))[0];
  if (!user) throw new Error("No user found.");

  let documents = 0;
  let properties = 0;

  for (const config of ENTITY_CONFIGS) {
    const rows = await queryD1<Row>(`select * from ${config.table} where user_id = ? and deleted_at is null`, [user.id]);
    await exec(
      `delete from source_document_properties
       where source_document_id in (
         select id from source_documents where user_id = ? and canonical_entity_type = ?
       )`,
      [user.id, config.entityType],
    );

    const documentRows: unknown[][] = [];
    const propertyRows: unknown[][] = [];

    for (const row of rows) {
      const entityId = String(row.id);
      const documentId = sourceDocId(user.id, config.entityType, entityId);
      const sourceId = String(inferSourceId(row, config.entityType));
      const title = normalize(row[config.titleColumn]) ?? `${config.entityType}:${entityId}`;
      const rawProperties: Record<string, unknown> = {};
      for (const key of config.properties) rawProperties[key] = row[key];

      documentRows.push(
        [
          documentId,
          user.id,
          "notion",
          sourceId,
          normalize(row.import_batch_id),
          config.sourceDatabase,
          title,
          config.role(row),
          config.entityType,
          entityId,
          normalize(row.status) ?? "active",
          JSON.stringify(rawProperties),
          config.preview(row),
        ],
      );
      documents += 1;

      for (const key of config.properties) {
        const value = row[key];
        const valueText = normalize(value);
        if (valueText === null) continue;
        propertyRows.push(
          [
            randomUUID(),
            documentId,
            key,
            key.replace(/_/g, " "),
            typeof value,
            valueText.slice(0, 1000),
            JSON.stringify(value),
            valueText.toLowerCase().slice(0, 256),
          ],
        );
        properties += 1;
      }
    }

    await bulkInsert(
      "source_documents",
      [
        "id",
        "user_id",
        "source_type",
        "source_id",
        "import_batch_id",
        "source_database",
        "title",
        "document_role",
        "canonical_entity_type",
        "canonical_entity_id",
        "status",
        "raw_properties",
        "raw_content_preview",
      ],
      documentRows,
      `on conflict(id) do update set
        source_id = excluded.source_id,
        import_batch_id = excluded.import_batch_id,
        source_database = excluded.source_database,
        title = excluded.title,
        document_role = excluded.document_role,
        canonical_entity_type = excluded.canonical_entity_type,
        canonical_entity_id = excluded.canonical_entity_id,
        status = excluded.status,
        raw_properties = excluded.raw_properties,
        raw_content_preview = excluded.raw_content_preview,
        resolved_at = datetime('now'),
        updated_at = datetime('now'),
        deleted_at = null`,
      7,
    );
    await bulkInsert(
      "source_document_properties",
      ["id", "source_document_id", "property_key", "property_name", "property_type", "value_text", "value_json", "normalized_value"],
      propertyRows,
      "",
      12,
    );
  }

  console.log(JSON.stringify({ documents, properties }, null, 2));
}

void rebuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
