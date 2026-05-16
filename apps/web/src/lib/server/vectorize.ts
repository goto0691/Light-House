import "server-only";

import { createHash } from "node:crypto";

import type { SearchItem } from "@/lib/mock/search";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  result?: {
    data?: Array<number[] | { embedding?: number[] }>;
  };
  errors?: Array<{ message?: string }>;
};

type VectorizeQueryResponse = {
  success?: boolean;
  result?: {
    count?: number;
    matches?: Array<{
      id?: string;
      score?: number;
      metadata?: Record<string, unknown>;
    }>;
  };
  errors?: Array<{ message?: string }>;
};

type ZettelVectorRow = {
  id: string;
  title: string;
  contentText: string | null;
  summary: string | null;
  category: string | null;
  vectorHash: string | null;
  vectorId: string | null;
  updatedAt: string;
};

type SearchZettelRow = {
  id: string;
  title: string;
  summary: string | null;
};

type SemanticSearchItem = {
  type: "zettel";
  id: string;
  title: string;
  snippet: string;
  href: string;
  score: number;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  }
  return value;
}

function getCloudflareToken() {
  return process.env.CLOUDFLARE_API_TOKEN ?? getRequiredEnv("DATABASE_AUTH_TOKEN");
}

function getCloudflareApiBase() {
  const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
}

function computeVectorHash(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function buildEmbeddingText(row: Pick<ZettelVectorRow, "title" | "contentText" | "summary" | "category">) {
  return [row.title, row.summary ?? "", row.category ?? "", row.contentText ?? ""].filter(Boolean).join("\n");
}

async function createEmbedding(text: string) {
  const response = await fetch(`${getCloudflareApiBase()}/ai/v1/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getCloudflareToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "@cf/baai/bge-m3",
      input: text,
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as EmbeddingResponse;
  if (!response.ok) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "Workers AI 임베딩 생성에 실패했습니다.";
    throw new Error(message);
  }

  const result = payload.data?.[0]?.embedding ?? (Array.isArray(payload.result?.data?.[0]) ? (payload.result?.data?.[0] as number[]) : payload.result?.data?.[0]?.embedding);
  if (!result?.length) {
    throw new Error("임베딩 응답이 비어 있습니다.");
  }

  return result;
}

async function upsertVectors(vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>) {
  if (!vectors.length) return;

  const formData = new FormData();
  const ndjson = vectors.map((vector) => JSON.stringify(vector)).join("\n");
  formData.append("vectors", new Blob([ndjson], { type: "application/x-ndjson" }), "embeddings.ndjson");

  const response = await fetch(`${getCloudflareApiBase()}/vectorize/v2/indexes/${getRequiredEnv("VECTORIZE_INDEX")}/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getCloudflareToken()}`,
    },
    body: formData,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as { errors?: Array<{ message?: string }> } | null;
  if (!response.ok) {
    const message = payload?.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "Vectorize 색인 저장에 실패했습니다.";
    throw new Error(message);
  }
}

async function queryVectors(vector: number[], topK: number) {
  const response = await fetch(`${getCloudflareApiBase()}/vectorize/v2/indexes/${getRequiredEnv("VECTORIZE_INDEX")}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getCloudflareToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vector,
      topK,
      returnMetadata: "all",
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as VectorizeQueryResponse;
  if (!response.ok || payload.success === false) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "Vectorize 검색에 실패했습니다.";
    throw new Error(message);
  }

  return payload.result?.matches ?? [];
}

export async function seedSemanticZettelIndex(limit = 25) {
  if (!process.env.VECTORIZE_INDEX) {
    return { indexed: 0, skipped: 0 };
  }

  const user = await resolveCurrentUser();
  const result = await queryD1<ZettelVectorRow>(
    `select
       id,
       title,
       content_text as contentText,
       summary,
       category,
       vector_hash as vectorHash,
       vector_id as vectorId,
       updated_at as updatedAt
     from zettels
     where user_id = ?
       and deleted_at is null
     order by updated_at desc`,
    [user.id],
  );

  const stale = result.rows
    .map((row) => {
      const embeddingText = buildEmbeddingText(row);
      return {
        row,
        embeddingText,
        nextHash: computeVectorHash(embeddingText),
      };
    })
    .filter((item) => item.embeddingText.trim().length > 0 && (item.row.vectorHash !== item.nextHash || !item.row.vectorId))
    .slice(0, limit);

  if (!stale.length) {
    return { indexed: 0, skipped: result.rows.length };
  }

  const vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }> = [];
  for (const item of stale) {
    const values = await createEmbedding(item.embeddingText);
    const vectorId = item.row.vectorId ?? `zettel:${item.row.id}`;
    vectors.push({
      id: vectorId,
      values,
      metadata: {
        zettelId: item.row.id,
        title: item.row.title,
        category: item.row.category ?? "",
        userId: user.id,
        updatedAt: item.row.updatedAt,
      },
    });
  }

  await upsertVectors(vectors);

  for (const item of stale) {
    const vectorId = item.row.vectorId ?? `zettel:${item.row.id}`;
    await executeD1(
      `update zettels
       set vector_id = ?, vector_hash = ?, updated_at = updated_at
       where id = ? and user_id = ?`,
      [vectorId, item.nextHash, item.row.id, user.id],
    );
  }

  return {
    indexed: stale.length,
    skipped: Math.max(0, result.rows.length - stale.length),
  };
}

export async function semanticSearchZettels(query: string, limit = 8): Promise<SearchItem[]> {
  if (!process.env.VECTORIZE_INDEX) {
    return [];
  }

  const user = await resolveCurrentUser();
  const queryVector = await createEmbedding(query);
  const matches = await queryVectors(queryVector, limit * 2);
  const filtered = matches.filter((match) => {
    const matchUserId = typeof match.metadata?.userId === "string" ? match.metadata.userId : null;
    return !matchUserId || matchUserId === user.id;
  });

  const ids = filtered
    .map((match) => (typeof match.metadata?.zettelId === "string" ? match.metadata.zettelId : null))
    .filter((id): id is string => Boolean(id))
    .slice(0, limit);

  if (!ids.length) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = await queryD1<SearchZettelRow>(
    `select id, title, summary
     from zettels
     where user_id = ?
       and deleted_at is null
       and id in (${placeholders})`,
    [user.id, ...ids],
  );

  const rowMap = new Map(rows.rows.map((row) => [row.id, row]));

  const items = filtered
    .map((match) => {
      const zettelId = typeof match.metadata?.zettelId === "string" ? match.metadata.zettelId : null;
      if (!zettelId) return null;
      const row = rowMap.get(zettelId);
      if (!row) return null;
      return {
        type: "zettel" as const,
        id: row.id,
        title: row.title,
        snippet: row.summary ?? "의미 검색 결과",
        href: `/vault/zettels?detail=zettel:${row.id}`,
        score: Number(match.score ?? 0.5),
      };
    })
    .filter((item): item is SemanticSearchItem => item !== null)
    .slice(0, limit);

  return items satisfies SearchItem[];
}
