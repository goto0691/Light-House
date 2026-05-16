import { NextResponse } from "next/server";

import type { ZettelMock } from "@/lib/mock/vault";
import { getSession } from "@/lib/auth/session";
import { createVaultZettel, getVaultZettelList, seedVaultSupportData } from "@/lib/server/vault";
import { getZettelSearchText, normalizeZettelDocumentKind } from "@/lib/vault/zettel-properties";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 120;

type ZettelListQuery = {
  limit: number;
  offset: number;
  q: string[];
  type: string[];
  documentKind: string[];
  status: string[];
  sourceReliability: string[];
  reviewCadence: string[];
  category: string[];
  tags: string[];
  property: string[];
  hasSourceDocument?: boolean;
  hasBacklinks?: boolean;
  hasOutgoingLinks?: boolean;
  sort: string;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  await seedVaultSupportData();
  const query = parseZettelListQuery(new URL(request.url).searchParams);
  const allZettels = await getVaultZettelList();
  const filtered = allZettels.filter((zettel) => zettelMatchesQuery(zettel, query));
  const sorted = sortZettels(filtered, query.sort);
  const zettels = sorted.slice(query.offset, query.offset + query.limit);

  return NextResponse.json({
    zettels,
    total: sorted.length,
    limit: query.limit,
    offset: query.offset,
    nextOffset: query.offset + zettels.length < sorted.length ? query.offset + zettels.length : null,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    type?: string;
    category?: string;
    content?: string;
    tags?: string[];
    status?: string;
    documentKind?: string;
    aliases?: string[];
    sourceReliability?: string;
    reviewCadence?: string;
    reviewDueAt?: string;
    originalCreatedAt?: string;
    source?: string;
    sourceUrl?: string;
    summary?: string;
  };

  const result = await createVaultZettel({
    title: body.title ?? "",
    type: body.type,
    category: body.category,
    content: body.content,
    tags: body.tags,
    status: body.status,
    documentKind: body.documentKind,
    aliases: body.aliases,
    sourceReliability: body.sourceReliability,
    reviewCadence: body.reviewCadence,
    reviewDueAt: body.reviewDueAt,
    originalCreatedAt: body.originalCreatedAt,
    source: body.source,
    sourceUrl: body.sourceUrl,
    summary: body.summary,
  });

  return NextResponse.json(result);
}

function parseZettelListQuery(searchParams: URLSearchParams): ZettelListQuery {
  const limit = clampNumber(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampNumber(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  return {
    limit,
    offset,
    q: readValues(searchParams, "q").map(normalizeFilterValue),
    type: readValues(searchParams, "type").map(normalizeFilterValue),
    documentKind: [...readValues(searchParams, "documentKind"), ...readValues(searchParams, "kind")].map(normalizeZettelDocumentKind).filter(Boolean),
    status: readValues(searchParams, "status").map(normalizeFilterValue),
    sourceReliability: readValues(searchParams, "sourceReliability").map(normalizeFilterValue),
    reviewCadence: readValues(searchParams, "reviewCadence").map(normalizeFilterValue),
    category: readValues(searchParams, "category").map(normalizeFilterValue),
    tags: readValues(searchParams, "tags").map(normalizeFilterValue),
    property: [...readValues(searchParams, "property"), ...readValues(searchParams, "sourceProperty")].map(normalizeFilterValue),
    hasSourceDocument: readBoolean(searchParams.get("hasSourceDocument")),
    hasBacklinks: readBoolean(searchParams.get("hasBacklinks")),
    hasOutgoingLinks: readBoolean(searchParams.get("hasOutgoingLinks")),
    sort: searchParams.get("sort") || "updated-desc",
  };
}

function clampNumber(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readValues(searchParams: URLSearchParams, key: string) {
  return searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function readBoolean(value: string | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizeFilterValue(value: string) {
  return value.toLowerCase().replaceAll("_", " ").trim();
}

function zettelMatchesQuery(zettel: ZettelMock, query: ZettelListQuery) {
  const searchText = getZettelSearchText(zettel);
  const type = normalizeFilterValue(zettel.type);
  const documentKind = normalizeZettelDocumentKind(zettel.documentKind);
  const status = normalizeFilterValue(zettel.status ?? "");
  const sourceReliability = normalizeFilterValue(zettel.sourceReliability ?? "unknown");
  const reviewCadence = normalizeFilterValue(zettel.reviewCadence ?? "none");
  const categorySearchText = [zettel.category, zettel.tags.join(" ")].join(" ").toLowerCase();
  const tags = zettel.tags.map(normalizeFilterValue);
  const propertySearchText = getSourcePropertySearchText(zettel);

  if (query.q.length && !query.q.every((term) => searchText.includes(term))) return false;
  if (query.type.length && !query.type.includes(type)) return false;
  if (query.documentKind.length && !query.documentKind.some((kind) => documentKind === kind || searchText.includes(kind))) return false;
  if (query.status.length && !query.status.includes(status)) return false;
  if (query.sourceReliability.length && !query.sourceReliability.includes(sourceReliability)) return false;
  if (query.reviewCadence.length && !query.reviewCadence.includes(reviewCadence)) return false;
  if (query.category.length && !query.category.some((category) => categorySearchText.includes(category))) return false;
  if (query.tags.length && !query.tags.every((tag) => tags.some((itemTag) => itemTag.includes(tag)))) return false;
  if (query.property.length && !query.property.every((term) => propertySearchText.includes(term))) return false;
  if (query.hasSourceDocument === true && !zettel.sourceDocument) return false;
  if (query.hasSourceDocument === false && zettel.sourceDocument) return false;
  if (query.hasBacklinks === true && !zettel.backlinks.length) return false;
  if (query.hasOutgoingLinks === true && !zettel.outgoingLinks.length) return false;
  return true;
}

function getSourcePropertySearchText(zettel: ZettelMock) {
  return [
    (zettel.aliases ?? []).join(" "),
    zettel.sourceReliability ?? "",
    zettel.reviewCadence ?? "",
    zettel.reviewDueAt ?? "",
    zettel.source ?? "",
    zettel.sourceUrl ?? "",
    zettel.originalCreatedAt ?? "",
    zettel.sourcePropertySearchText ?? "",
    zettel.sourceDocument?.sourceDatabase ?? "",
    zettel.sourceDocument?.url ?? "",
    zettel.sourceDocument?.documentRole ?? "",
    zettel.sourceDocument?.status ?? "",
    zettel.sourceDocument?.properties.flatMap((property) => [property.name, property.value, property.type ?? ""]).join(" ") ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function sortZettels(zettels: ZettelMock[], sort: string) {
  const sorted = [...zettels];
  if (sort === "title-asc") return sorted.sort((left, right) => left.title.localeCompare(right.title, "ko-KR"));
  if (sort === "kind-asc") return sorted.sort((left, right) => normalizeZettelDocumentKind(left.documentKind).localeCompare(normalizeZettelDocumentKind(right.documentKind)));
  if (sort === "created-desc") return sorted.sort((left, right) => getTimeValue(right.createdAt) - getTimeValue(left.createdAt));
  return sorted.sort((left, right) => Number(right.pinned ?? false) - Number(left.pinned ?? false) || getTimeValue(right.updatedAt ?? right.createdAt) - getTimeValue(left.updatedAt ?? left.createdAt));
}

function getTimeValue(value: string | null | undefined) {
  return value ? new Date(value).getTime() || 0 : 0;
}
