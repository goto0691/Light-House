import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: { changes?: number }; results?: T[]; success?: boolean }>;
  success?: boolean;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

type UserRow = { id: string; email: string };
type CandidateRow = {
  entityType: "zettel" | "media" | "daily_log" | "workout" | "person";
  entityId: string;
  sourceDocumentId: string | null;
  title: string;
  currentRole: string | null;
  currentStatus: string | null;
  currentTags: string | null;
  rawProperties: string | null;
  preview: string | null;
  body: string | null;
};

type AiCuration = {
  classification:
    | "keep_vault"
    | "move_to_life_ops"
    | "move_to_media"
    | "keep_prm"
    | "archive_work"
    | "delete_auto_log"
    | "needs_manual_review";
  confidence: number;
  tags: string[];
  targetEntityType: "zettel" | "daily_log" | "workout" | "media" | "person" | "none";
  shouldHideOriginal: boolean;
  shouldDeleteOriginal: boolean;
  extracted: {
    title?: string;
    date?: string;
    summary?: string;
    mediaType?: "game" | "screen" | "book" | "other";
    journal?: string;
    meditation?: string;
    meditationVerse?: string;
    workoutCategories?: string[];
    peopleMentions?: string[];
  };
  notionUseCase: string;
  requiredViews: string[];
  preservedFields: string[];
  reason: string;
};

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 25);
const offset = Number(process.argv.find((arg) => arg.startsWith("--offset="))?.split("=")[1] ?? 0);
const includeAllImported = args.has("--all-imported");
const delayMs = Number(process.argv.find((arg) => arg.startsWith("--delay-ms="))?.split("=")[1] ?? 4500);
const minConfidenceForAutoReview = Number(process.argv.find((arg) => arg.startsWith("--min-confidence="))?.split("=")[1] ?? 0.65);

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
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function hashId(prefix: string, parts: Array<string | null | undefined>) {
  return `${prefix}_${createHash("sha1").update(parts.map((part) => part ?? "").join("|")).digest("hex").slice(0, 32)}`;
}

function clampText(value: string | null | undefined, max = 7000) {
  const text = (value ?? "").replace(/\u0000/g, "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.floor(max * 0.72))}\n\n...[middle truncated for token budget]...\n\n${text.slice(-Math.floor(max * 0.28))}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function d1Endpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${requiredEnv("CLOUDFLARE_D1_DATABASE_ID")}/query`;
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const response = await fetch(d1Endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? requiredEnv("DATABASE_AUTH_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const payload = (await response.json()) as D1Envelope<T>;
  const result = payload.result?.[0];
  if (!response.ok || payload.success === false || result?.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "D1 query failed.");
  }
  return { rows: result?.results ?? [], meta: result?.meta ?? {} };
}

async function exec(sql: string, params: unknown[] = []) {
  if (!apply) return { changes: 0 };
  return (await queryD1(sql, params)).meta;
}

async function callGemini(row: CandidateRow): Promise<{ curation: AiCuration; usage: { inputTokens: number; outputTokens: number } }> {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite-preview";
  const started = Date.now();
  const prompt = [
    "Classify this migrated Notion/Light House record for cleanup.",
    "Goal: preserve the user's old Notion usability through tags and saved views, not by creating new silos.",
    "Use only the allowed classification enum.",
    "Important rules:",
    "- delete_auto_log only for generated daily/workout shell data with no real user content.",
    "- archive_work for old workplace/hospital/operation documents that should not show in default personal views.",
    "- move_to_life_ops for diary, meditation, daily reflection, workout records, or date-based life records with useful content.",
    "- move_to_media for games, books, movies, dramas, anime, webtoon, content logs, reviews, play/watch/read records.",
    "- keep_prm only for real people/relationship records.",
    "- keep_vault for sermons, faith notes, creative writing, ideas, essays, knowledge notes.",
    "- needs_manual_review when uncertain.",
    "",
    JSON.stringify(
      {
        entityType: row.entityType,
        entityId: row.entityId,
        sourceDocumentId: row.sourceDocumentId,
        title: row.title,
        currentRole: row.currentRole,
        currentStatus: row.currentStatus,
        currentTags: row.currentTags,
        rawProperties: clampText(row.rawProperties, 2500),
        preview: clampText(row.preview, 1600),
        body: clampText(row.body, 7000),
      },
      null,
      2,
    ),
  ].join("\n");

  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": requiredEnv("GEMINI_API_KEY"),
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "You are a conservative Korean/English personal data migration curator. Return only valid JSON. Prefer preserving user-authored content. Never invent facts. Keep confidence calibrated.",
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 1600,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "high" },
        responseJsonSchema: {
          type: "object",
          properties: {
            classification: {
              type: "string",
              enum: ["keep_vault", "move_to_life_ops", "move_to_media", "keep_prm", "archive_work", "delete_auto_log", "needs_manual_review"],
            },
            confidence: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
            targetEntityType: { type: "string", enum: ["zettel", "daily_log", "workout", "media", "person", "none"] },
            shouldHideOriginal: { type: "boolean" },
            shouldDeleteOriginal: { type: "boolean" },
            extracted: {
              type: "object",
              properties: {
                title: { type: "string" },
                date: { type: "string" },
                summary: { type: "string" },
                mediaType: { type: "string", enum: ["game", "screen", "book", "other"] },
                journal: { type: "string" },
                meditation: { type: "string" },
                meditationVerse: { type: "string" },
                workoutCategories: { type: "array", items: { type: "string" } },
                peopleMentions: { type: "array", items: { type: "string" } },
              },
            },
            notionUseCase: { type: "string" },
            requiredViews: { type: "array", items: { type: "string" } },
            preservedFields: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
          },
          required: [
            "classification",
            "confidence",
            "tags",
            "targetEntityType",
            "shouldHideOriginal",
            "shouldDeleteOriginal",
            "extracted",
            "notionUseCase",
            "requiredViews",
            "preservedFields",
            "reason",
          ],
        },
      },
    }),
  } satisfies RequestInit;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, request);

  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok || payload.error?.message) {
    throw new Error(payload.error?.message || `Gemini failed with HTTP ${response.status}.`);
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned empty output.");

  const parsed = parseGeminiJson(text);
  return {
    curation: parsed as AiCuration,
    usage: {
      inputTokens: payload.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4),
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4),
    },
  };
}

function parseGeminiJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return JSON.parse(fenced) as unknown;
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1)) as unknown;
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 500)}`);
  }
}

async function upsertFailedReviewItem(userId: string, row: CandidateRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const id = hashId("mri_ai_error", [userId, row.entityType, row.entityId, "ai:parse_error"]);
  await exec(
    `insert into migration_review_items
      (id, user_id, source_document_id, entity_type, entity_id, issue_type, suggested_action, confidence, status, reason, payload, created_at, updated_at)
     values (?, ?, ?, ?, ?, 'ai:parse_error', 'manual_review', 0.1, 'open', ?, ?, datetime('now'), datetime('now'))
     on conflict(id) do update set
       reason = excluded.reason,
       payload = excluded.payload,
       updated_at = datetime('now'),
       deleted_at = null`,
    [
      id,
      userId,
      row.sourceDocumentId,
      row.entityType,
      row.entityId,
      `Gemini curation failed and requires manual review: ${message.slice(0, 240)}`,
      JSON.stringify({ error: message, original: row }),
    ],
  );
}

function suggestedAction(curation: AiCuration) {
  if (curation.classification === "delete_auto_log") return "delete_auto_log";
  if (curation.classification === "archive_work") return "tag_archive_hide_from_default";
  if (curation.classification === "move_to_life_ops") return "extract_to_life_ops";
  if (curation.classification === "move_to_media") return "merge_to_media";
  if (curation.classification === "keep_prm") return "keep_in_prm";
  if (curation.classification === "keep_vault") return "tag_and_keep_in_vault";
  return "manual_review";
}

async function upsertReviewItem(userId: string, row: CandidateRow, curation: AiCuration, usage: { inputTokens: number; outputTokens: number }) {
  const issueType = `ai:${curation.classification}`;
  const id = hashId("mri_ai", [userId, row.entityType, row.entityId, issueType]);
  const status = curation.confidence >= minConfidenceForAutoReview ? "open" : "open";
  const payload = {
    ai: curation,
    usage,
    original: {
      entityType: row.entityType,
      entityId: row.entityId,
      sourceDocumentId: row.sourceDocumentId,
      title: row.title,
      currentRole: row.currentRole,
      currentStatus: row.currentStatus,
      currentTags: row.currentTags,
    },
  };
  await exec(
    `insert into migration_review_items
      (id, user_id, source_document_id, entity_type, entity_id, issue_type, suggested_action, confidence, status, reason, payload, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     on conflict(id) do update set
       source_document_id = excluded.source_document_id,
       suggested_action = excluded.suggested_action,
       confidence = excluded.confidence,
       status = excluded.status,
       reason = excluded.reason,
       payload = excluded.payload,
       updated_at = datetime('now'),
       deleted_at = null`,
    [
      id,
      userId,
      row.sourceDocumentId,
      row.entityType,
      row.entityId,
      issueType,
      suggestedAction(curation),
      curation.confidence,
      status,
      curation.reason,
      JSON.stringify(payload),
    ],
  );
}

async function fetchCandidates(userId: string) {
  const where = includeAllImported
    ? `z.import_batch_id is not null`
    : `exists (
         select 1
         from taggings tg
         inner join tags t on t.id = tg.tag_id
         where tg.taggable_type = 'zettel'
           and tg.taggable_id = z.id
           and t.slug in ('needs-review', 'archive-work')
       )`;

  return queryD1<CandidateRow>(
    `select
       'zettel' as entityType,
       z.id as entityId,
       sd.id as sourceDocumentId,
       z.title,
       coalesce(sd.document_role, z.type) as currentRole,
       sd.status as currentStatus,
       (
         select group_concat(t.slug, ',')
         from taggings tg
         inner join tags t on t.id = tg.tag_id
         where tg.taggable_type = 'zettel' and tg.taggable_id = z.id
       ) as currentTags,
       sd.raw_properties as rawProperties,
       sd.raw_content_preview as preview,
       coalesce(z.content_text, z.content, z.summary, '') as body
     from zettels z
     left join source_documents sd on sd.user_id = z.user_id and sd.canonical_entity_type = 'zettel' and sd.canonical_entity_id = z.id and sd.deleted_at is null
     where z.user_id = ?
       and z.deleted_at is null
       and ${where}
       and not exists (
         select 1
         from migration_review_items mri
         where mri.user_id = z.user_id
           and mri.entity_type = 'zettel'
           and mri.entity_id = z.id
           and mri.issue_type like 'ai:%'
           and mri.deleted_at is null
       )
     order by z.updated_at desc, z.id asc
     limit ? offset ?`,
    [userId, limit, offset],
  );
}

async function main() {
  loadEnv();
  requiredEnv("GEMINI_API_KEY");

  const email = process.env.LIGHT_HOUSE_ADMIN_EMAIL;
  const user = (
    email
      ? await queryD1<UserRow>("select id, email from users where email = ? limit 1", [email])
      : await queryD1<UserRow>("select id, email from users limit 1")
  ).rows[0];
  if (!user) throw new Error("No user found.");

  const candidates = (await fetchCandidates(user.id)).rows;
  const results: Array<{ id: string; title: string; curation: AiCuration; usage: { inputTokens: number; outputTokens: number } }> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const [index, row] of candidates.entries()) {
    try {
      let result: Awaited<ReturnType<typeof callGemini>>;
      try {
        result = await callGemini(row);
      } catch {
        await sleep(1200);
        result = await callGemini(row);
      }
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
      results.push({ id: row.entityId, title: row.title, curation: result.curation, usage: result.usage });
      await upsertReviewItem(user.id, row, result.curation, result.usage);
      console.log(
        JSON.stringify({
          index: offset + index + 1,
          id: row.entityId,
          title: row.title,
          classification: result.curation.classification,
          confidence: result.curation.confidence,
          action: suggestedAction(result.curation),
        }),
      );
    } catch (error) {
      await upsertFailedReviewItem(user.id, row, error);
      console.log(
        JSON.stringify({
          index: offset + index + 1,
          id: row.entityId,
          title: row.title,
          classification: "parse_error",
          confidence: 0,
          action: "manual_review",
          error: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
        }),
      );
    }
    if (index < candidates.length - 1) await sleep(delayMs);
  }

  const summary = {
    mode: apply ? "apply-review-items" : "dry-run",
    model: process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite-preview",
    scanned: candidates.length,
    inputTokens,
    outputTokens,
    byClassification: results.reduce<Record<string, number>>((acc, item) => {
      acc[item.curation.classification] = (acc[item.curation.classification] ?? 0) + 1;
      return acc;
    }, {}),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (apply) {
    await exec(
      `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
       values (?, ?, 'migration.ai_curate.batch', 'user', ?, ?, datetime('now'))`,
      [randomUUID(), user.id, user.id, JSON.stringify(summary)],
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
