"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type {
  ContextBundle,
  ContextEdge,
  ContextSearchResult,
  EntityType,
  SourceTraceDocument,
  SourceTraceRelation,
  SourceTraceReviewItem,
} from "@/lib/context/types";

export function SourceTracePanel({ bundle, onResolved }: { bundle: ContextBundle; onResolved?: (bundle: ContextBundle) => void }) {
  const [documents, setDocuments] = useState<SourceTraceDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const sourceDocumentIds = useMemo(() => collectSourceDocumentIds(bundle), [bundle]);
  const sourceEdges = bundle.edges.filter((edge) => edge.kind === "source" || edge.kind === "inferred");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (sourceDocumentIds.length) {
      params.set("sourceDocumentIds", sourceDocumentIds.join(","));
    } else {
      params.set("focusType", bundle.focus.type);
      params.set("focusId", bundle.focus.id);
    }

    setIsLoading(true);
    setError(null);
    fetch(`/api/context/source-trace?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Source trace API failed");
        return (await response.json()) as { documents: SourceTraceDocument[] };
      })
      .then((payload) => setDocuments(payload.documents))
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError("원본 추적 데이터를 불러오지 못했습니다.");
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [bundle.focus.id, bundle.focus.type, refreshKey, sourceDocumentIds]);

  const propertyCount = documents.reduce((sum, document) => sum + document.properties.length, 0);
  const relationCount = documents.reduce((sum, document) => sum + document.relations.length, 0);
  const reviewCount = documents.reduce((sum, document) => sum + document.reviewItems.length, 0);

  if (!documents.length && !sourceEdges.length && !isLoading) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-primary">Source Trace</p>
        <p className="mt-3 text-sm text-muted-foreground">연결된 원본 문서가 아직 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-primary">Source Trace</p>
          <h3 className="mt-2 text-lg font-semibold text-foreground">원본 문서 변환 감사</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Notion 원본 속성, canonical 변환, 관계 확정 상태를 한곳에서 확인합니다.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground">
          {documents.length} docs · {propertyCount} props · {relationCount} relations · {reviewCount} reviews
        </span>
      </div>

      {isLoading ? <p className="mt-4 text-sm text-muted-foreground">원본 추적 데이터를 불러오는 중입니다.</p> : null}
      {error ? <p className="mt-4 rounded-md border border-[hsl(var(--color-feedback-warning)/0.24)] bg-[hsl(var(--color-feedback-warning)/0.08)] p-3 text-xs text-[hsl(var(--color-feedback-warning))]">{error}</p> : null}

      <div className="mt-4 grid gap-4">
        {documents.map((document) => (
          <article className="rounded-lg border border-white/10 bg-black/10 p-3" key={document.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{document.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {document.sourceDatabase ?? document.sourceType} · {document.sourceId}
                </p>
              </div>
              <StatusBadge status={document.status} />
            </div>

            <div className="mt-3 grid gap-3">
              <CanonicalMapping canonicalText={bundle.focus.preview} document={document} />
              <RawProperties canonicalText={bundle.focus.preview} document={document} />
              <SourceRelations
                bundle={bundle}
                document={document}
                onResolved={onResolved}
                onTraceRefresh={() => setRefreshKey((value) => value + 1)}
              />
              <ReviewItems items={document.reviewItems} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function collectSourceDocumentIds(bundle: ContextBundle) {
  const ids = new Set<string>();
  for (const node of bundle.grouped.source) {
    if (isRealSourceDocumentId(node.id)) ids.add(node.id);
  }
  if (bundle.focus.sourceDocumentId && isRealSourceDocumentId(bundle.focus.sourceDocumentId)) ids.add(bundle.focus.sourceDocumentId);
  for (const edge of bundle.edges) {
    for (const evidence of edge.evidence) {
      if (evidence.sourceDocumentId && isRealSourceDocumentId(evidence.sourceDocumentId)) ids.add(evidence.sourceDocumentId);
    }
  }
  return [...ids].sort();
}

function isRealSourceDocumentId(id: string) {
  return !id.startsWith("unresolved:") && !id.startsWith("review:");
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "open"
      ? "border-[hsl(var(--color-feedback-warning)/0.26)] bg-[hsl(var(--color-feedback-warning)/0.08)] text-[hsl(var(--color-feedback-warning))]"
      : status === "applied" || status === "resolved" || status === "mapped"
        ? "border-[hsl(var(--color-feedback-success)/0.26)] bg-[hsl(var(--color-feedback-success)/0.08)] text-[hsl(var(--color-feedback-success))]"
        : status === "dismissed"
          ? "border-white/10 bg-white/5 text-muted-foreground"
          : "border-primary/20 bg-primary/10 text-primary";
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>{status}</span>;
}

function CanonicalMapping({ canonicalText, document }: { canonicalText?: string; document: SourceTraceDocument }) {
  const previewDuplicatesCanonical = Boolean(document.rawContentPreview && canonicalText && isDuplicateText(document.rawContentPreview, canonicalText));
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <SectionTitle label="Canonical Mapping" count={document.canonicalEntityType ? "mapped" : "unmapped"} />
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <MappingBox label="Source" title={document.sourceDatabase ?? document.sourceType} detail={document.documentRole ?? document.sourceId} />
        <span className="hidden text-muted-foreground sm:block">→</span>
        <MappingBox
          label="Canonical"
          title={document.canonicalEntityType ?? "미확정"}
          detail={document.canonicalEntityId ?? "연결된 현재 엔티티 없음"}
          tone={document.canonicalEntityType ? "success" : "warning"}
        />
      </div>
      {document.rawContentPreview ? (
        previewDuplicatesCanonical ? (
          <p className="mt-3 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground">원본 preview는 canonical 본문과 동일하여 접었습니다.</p>
        ) : (
          <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{document.rawContentPreview}</p>
        )
      ) : null}
    </section>
  );
}

function MappingBox({ label, title, detail, tone }: { label: string; title: string; detail?: string; tone?: "success" | "warning" }) {
  const border = tone === "success" ? "border-[hsl(var(--color-feedback-success)/0.24)]" : tone === "warning" ? "border-[hsl(var(--color-feedback-warning)/0.24)]" : "border-white/10";
  return (
    <div className={`rounded-md border ${border} bg-black/10 p-3`}>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{title}</p>
      {detail ? <p className="mt-1 break-all text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function RawProperties({ canonicalText, document }: { canonicalText?: string; document: SourceTraceDocument }) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <SectionTitle label="Raw Properties" count={`${document.properties.length}`} />
      {document.properties.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {document.properties.map((property) => (
                <RawPropertyRow canonicalText={canonicalText} key={property.id} property={property} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">저장된 원본 속성이 없습니다.</p>
      )}
    </section>
  );
}

function RawPropertyRow({
  canonicalText,
  property,
}: {
  canonicalText?: string;
  property: SourceTraceDocument["properties"][number];
}) {
  const value = propertyValue(property);
  const duplicate = canonicalText ? isDuplicateText(value, canonicalText) : false;
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="py-2 pr-3 align-top font-medium text-foreground">{property.propertyName || property.propertyKey}</td>
      <td className="py-2 pr-3 align-top text-muted-foreground">{property.propertyType ?? "-"}</td>
      <td className="max-w-[420px] py-2 align-top text-muted-foreground">
        {duplicate ? (
          <details>
            <summary className="cursor-pointer text-[hsl(var(--color-feedback-success))]">본문과 동일함</summary>
            <span className="mt-2 block line-clamp-3 break-words">{value}</span>
          </details>
        ) : (
          <span className="line-clamp-3 break-words">{value}</span>
        )}
      </td>
    </tr>
  );
}

function SourceRelations({
  bundle,
  document,
  onResolved,
  onTraceRefresh,
}: {
  bundle: ContextBundle;
  document: SourceTraceDocument;
  onResolved?: (bundle: ContextBundle) => void;
  onTraceRefresh: () => void;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <SectionTitle label="Source Relations" count={`${document.relations.length}`} />
      {document.relations.length ? (
        <div className="mt-3 grid gap-2">
          {document.relations.map((relation) => (
            <div className="rounded-md border border-white/10 bg-black/10 p-3" key={relation.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-foreground">{relation.relationName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{relation.targetTitle ?? relation.targetSourceId ?? "대상 원본 없음"}</p>
                </div>
                <StatusBadge status={relation.resolvedEntityType && relation.resolvedEntityId ? "resolved" : "unresolved"} />
              </div>
              {relation.resolvedEntityType && relation.resolvedEntityId ? (
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  {relation.resolvedEntityType} · {relation.resolvedEntityId}
                </p>
              ) : (
                <div className="mt-3">
                  <SourceRelationResolver edge={relationEdge(bundle, document, relation)} onResolved={onResolved} onAfterResolve={onTraceRefresh} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">원본 문서에 기록된 relation 속성이 없습니다.</p>
      )}
    </section>
  );
}

function ReviewItems({ items }: { items: SourceTraceReviewItem[] }) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <SectionTitle label="Review Items" count={`${items.length}`} />
      {items.length ? (
        <div className="mt-3 grid gap-2">
          {items.map((item) => (
            <div className="rounded-md border border-white/10 bg-black/10 p-3" key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-foreground">{item.issueType}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.suggestedAction}</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
              {item.reason ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.reason}</p> : null}
              <p className="mt-2 break-all text-[11px] text-muted-foreground">
                {item.entityType}
                {item.entityId ? ` · ${item.entityId}` : ""}
                {typeof item.confidence === "number" ? ` · ${Math.round(item.confidence * 100)}%` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">이 문서에 연결된 리뷰 항목이 없습니다.</p>
      )}
    </section>
  );
}

function SectionTitle({ label, count }: { label: string; count: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</h4>
      <span className="rounded-full border border-white/10 bg-black/10 px-2 py-0.5 text-[11px] text-muted-foreground">{count}</span>
    </div>
  );
}

function propertyValue(property: SourceTraceDocument["properties"][number]) {
  if (property.valueText) return property.valueText;
  if (property.normalizedValue) return property.normalizedValue;
  if (!property.valueJson) return "-";
  try {
    const parsed = JSON.parse(property.valueJson) as unknown;
    return JSON.stringify(parsed);
  } catch {
    return property.valueJson;
  }
}

function normalizeForSimilarity(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .toLowerCase();
}

function isDuplicateText(raw: string, canonical: string) {
  const left = normalizeForSimilarity(raw);
  const right = normalizeForSimilarity(canonical);
  if (left.length < 80 || right.length < 80) return left.length > 0 && left === right;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.9) return true;
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 1));
  if (!leftTokens.size || !rightTokens.size) return false;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.min(leftTokens.size, rightTokens.size) >= 0.9;
}

function relationEdge(bundle: ContextBundle, document: SourceTraceDocument, relation: SourceTraceRelation): ContextEdge {
  return {
    id: relation.id,
    from: { type: bundle.focus.type, id: bundle.focus.id },
    to: {
      type: relation.resolvedEntityType ?? "source_document",
      id: relation.resolvedEntityId ?? `unresolved:${relation.id}`,
    },
    label: relation.relationName,
    kind: "source",
    confidence: relation.confidence ?? 0.5,
    evidence: [
      {
        source: "source_document",
        sourceDocumentId: document.id,
        propertyName: relation.relationName,
        snippet: relation.targetTitle ?? relation.targetSourceId,
      },
    ],
    createdAt: relation.createdAt,
  };
}

function SourceRelationResolver({
  edge,
  onResolved,
  onAfterResolve,
}: {
  edge: ContextEdge;
  onResolved?: (bundle: ContextBundle) => void;
  onAfterResolve?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createType, setCreateType] = useState<EntityType>("person");
  const [results, setResults] = useState<ContextSearchResult[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/context/search?${new URLSearchParams({ q: trimmed }).toString()}`, { signal: controller.signal });
      if (!response.ok) return;
      const payload = (await response.json()) as { results: ContextSearchResult[] };
      setResults(payload.results.slice(0, 5));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  function resolve(targetType: EntityType, targetId: string) {
    startTransition(async () => {
      const response = await fetch("/api/context/resolve-source-relation", {
        body: JSON.stringify({
          sourceRelationId: edge.id,
          targetId,
          targetType,
          label: edge.label,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { bundle: ContextBundle };
      onResolved?.(payload.bundle);
      onAfterResolve?.();
      if (!onResolved) window.location.reload();
    });
  }

  function createAndResolve() {
    const title = createTitle.trim() || query.trim();
    if (!title) return;
    startTransition(async () => {
      const response = await fetch("/api/context/canonical-entities", {
        body: JSON.stringify({
          focusId: edge.from.id,
          focusType: edge.from.type,
          label: edge.label,
          sourceRelationId: edge.id,
          targetType: createType,
          title,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { bundle: ContextBundle };
      onResolved?.(payload.bundle);
      onAfterResolve?.();
      if (!onResolved) window.location.reload();
    });
  }

  return (
    <div className="rounded-md border border-[hsl(var(--color-feedback-warning)/0.24)] bg-[hsl(var(--color-feedback-warning)/0.08)] p-3">
      <p className="text-xs font-medium text-[hsl(var(--color-feedback-warning))]">원본 관계 확정</p>
      <input
        className="mt-2 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-foreground outline-none"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="확정할 canonical 항목 검색"
        value={query}
      />
      <div className="mt-2 grid gap-1.5">
        {results.map((result) => (
          <button
            className="focus-ring rounded-md border border-white/10 bg-black/10 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-50"
            disabled={isPending}
            key={`${result.type}:${result.id}`}
            onClick={() => resolve(result.type, result.id)}
            type="button"
          >
            {result.title} · {result.type}
          </button>
        ))}
      </div>
      <div className="mt-3 border-t border-white/10 pt-3">
        <p className="text-xs font-medium text-muted-foreground">검색 결과가 없으면 새 canonical로 생성</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
          <select
            className="rounded-md border border-white/10 bg-black/20 px-2 py-2 text-xs text-foreground outline-none"
            onChange={(event) => setCreateType(event.target.value as EntityType)}
            value={createType}
          >
            <option value="person">Person</option>
            <option value="zettel">Zettel</option>
            <option value="project">Project</option>
            <option value="media">Media</option>
            <option value="place">Place</option>
          </select>
          <input
            className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-foreground outline-none"
            onChange={(event) => setCreateTitle(event.target.value)}
            placeholder="새 엔티티 이름"
            value={createTitle}
          />
        </div>
        <button
          className="focus-ring mt-2 min-h-10 w-full rounded-md border border-white/10 bg-black/10 px-3 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:opacity-50"
          disabled={isPending || !(createTitle.trim() || query.trim())}
          onClick={createAndResolve}
          type="button"
        >
          생성 후 관계 확정
        </button>
      </div>
    </div>
  );
}
