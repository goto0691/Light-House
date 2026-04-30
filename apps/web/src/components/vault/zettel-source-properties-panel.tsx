"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink } from "lucide-react";

import { GlassCard } from "@/components/shared/glass-card";
import type { ZettelFormState } from "@/components/vault/zettel-form";
import type { SourceDocumentInfo } from "@/lib/mock/vault";
import { cn } from "@/lib/utils/cn";
import { normalizeZettelDocumentKind } from "@/lib/vault/zettel-properties";

type SourcePropertyTarget =
  | "skip"
  | "title"
  | "summary"
  | "category"
  | "documentKind"
  | "status"
  | "aliases"
  | "sourceReliability"
  | "reviewCadence"
  | "reviewDueAt"
  | "source"
  | "sourceUrl"
  | "originalCreatedAt"
  | "tags";

type ZettelSourcePropertiesPanelProps = {
  form: ZettelFormState;
  onChange: (patch: Partial<ZettelFormState>) => void;
  sourceDocument?: SourceDocumentInfo | null;
};

const TARGET_OPTIONS: Array<{ value: SourcePropertyTarget; label: string }> = [
  { value: "skip", label: "Keep Raw" },
  { value: "title", label: "Title" },
  { value: "summary", label: "Summary" },
  { value: "category", label: "Category" },
  { value: "documentKind", label: "Kind" },
  { value: "status", label: "Status" },
  { value: "tags", label: "Tags" },
  { value: "aliases", label: "Aliases" },
  { value: "sourceReliability", label: "Reliability" },
  { value: "reviewCadence", label: "Review Cadence" },
  { value: "reviewDueAt", label: "Review Due" },
  { value: "source", label: "Source" },
  { value: "sourceUrl", label: "Source URL" },
  { value: "originalCreatedAt", label: "Original Date" },
];

export function ZettelSourcePropertiesPanel({ form, onChange, sourceDocument }: ZettelSourcePropertiesPanelProps) {
  const visibleProperties = useMemo(() => sourceDocument?.properties.filter((property) => property.value.trim()) ?? [], [sourceDocument]);
  const [targets, setTargets] = useState<Record<string, SourcePropertyTarget>>({});
  if (!sourceDocument) return null;
  const document = sourceDocument;

  function targetFor(property: SourceDocumentInfo["properties"][number]) {
    const key = propertyKey(property);
    return targets[key] ?? guessTarget(property, document);
  }

  function applyProperty(property: SourceDocumentInfo["properties"][number]) {
    const target = targetFor(property);
    const value = property.value.trim();
    if (!value || target === "skip") return;
    onChange(propertyPatch(target, value, form, document));
  }

  return (
    <GlassCard priority="secondary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Imported Properties</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {document.sourceDatabase ?? "source"} · {document.status}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {document.url ? (
            <a
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/10 text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
              href={document.url}
              rel="noreferrer"
              target="_blank"
              title="Open source"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {visibleProperties.length} properties
          </span>
        </div>
      </div>

      {document.preview ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">{document.preview}</p> : null}

      {visibleProperties.length ? (
        <div className="mt-4 grid gap-2">
          {visibleProperties.map((property) => {
            const key = propertyKey(property);
            const target = targetFor(property);
            const applicable = target !== "skip" && Boolean(property.value.trim());
            return (
              <div className="grid gap-3 rounded-md border border-white/10 bg-black/10 p-3 lg:grid-cols-[minmax(0,1fr)_180px_96px]" key={key}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{property.name}</p>
                    {property.type ? <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">{property.type}</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-3 break-words text-sm text-foreground">{property.value}</p>
                </div>
                <select
                  className="input-base h-10 py-0 text-xs"
                  onChange={(event) => setTargets((current) => ({ ...current, [key]: event.target.value as SourcePropertyTarget }))}
                  value={target}
                >
                  {TARGET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  className={cn(
                    "focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                    applicable ? "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15" : "border-white/10 bg-white/5 text-muted-foreground",
                  )}
                  disabled={!applicable}
                  onClick={() => applyProperty(property)}
                  type="button"
                >
                  <Check className="h-4 w-4" />
                  적용
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-white/15 bg-black/10 p-3 text-sm text-muted-foreground">
          가져온 원본 문서는 있지만 노출된 속성은 없습니다.
        </p>
      )}
    </GlassCard>
  );
}

function propertyKey(property: SourceDocumentInfo["properties"][number]) {
  return `${property.name}:${property.type ?? ""}:${property.value}`;
}

function guessTarget(property: SourceDocumentInfo["properties"][number], sourceDocument: SourceDocumentInfo): SourcePropertyTarget {
  const name = normalize(property.name);
  const type = normalize(property.type ?? "");
  const value = property.value.trim();

  if (looksLikeUrl(value) || name.includes("url") || name.includes("링크")) return "sourceUrl";
  if (name.includes("제목") || name === "title") return "title";
  if (name.includes("요약") || name.includes("summary") || name.includes("description")) return "summary";
  if (name.includes("상태") || name.includes("status")) return "status";
  if (name.includes("별칭") || name.includes("alias")) return "aliases";
  if (name.includes("신뢰") || name.includes("reliability")) return "sourceReliability";
  if (name.includes("복습 주기") || name.includes("검토 주기") || name.includes("review cadence")) return "reviewCadence";
  if (name.includes("복습일") || name.includes("검토일") || name.includes("review due")) return "reviewDueAt";
  if (name.includes("날짜") || name.includes("일시") || name.includes("created") || type.includes("date")) return "originalCreatedAt";
  if (name.includes("태그") || name.includes("키워드") || name.includes("topic") || name.includes("tag") || type.includes("multi")) return "tags";
  if (name.includes("카테고리") || name.includes("category")) return "category";
  if (name.includes("유형") || name.includes("종류") || name.includes("kind") || name.includes("type")) return "documentKind";
  if (name.includes("출처") || name.includes("source") || sourceDocument.sourceDatabase?.toLowerCase().includes(name)) return "source";
  return "skip";
}

function propertyPatch(target: SourcePropertyTarget, value: string, form: ZettelFormState, sourceDocument: SourceDocumentInfo): Partial<ZettelFormState> {
  if (target === "title") return { title: value };
  if (target === "summary") return { summary: value };
  if (target === "category") return { category: compactSingleLine(value, 80) };
  if (target === "documentKind") return { documentKind: normalizeZettelDocumentKind(value) };
  if (target === "status") return { status: normalizeStatus(value) || form.status };
  if (target === "aliases") return { aliases: mergeAliases(form.aliases, value) };
  if (target === "sourceReliability") return { sourceReliability: normalizeSourceReliability(value) };
  if (target === "reviewCadence") return { reviewCadence: normalizeReviewCadence(value) };
  if (target === "reviewDueAt") return { reviewDueAt: normalizeDate(value) || form.reviewDueAt };
  if (target === "source") return { source: sourceDocument.sourceDatabase ?? compactSingleLine(value, 80) };
  if (target === "sourceUrl") return { sourceUrl: firstUrl(value) ?? sourceDocument.url ?? form.sourceUrl };
  if (target === "originalCreatedAt") return { originalCreatedAt: normalizeDate(value) || form.originalCreatedAt };
  if (target === "tags") return { tags: mergeTags(form.tags, value) };
  return {};
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

function compactSingleLine(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function firstUrl(value: string) {
  return value.match(/https?:\/\/[^\s)\]}>"']+/i)?.[0] ?? null;
}

function normalizeDate(value: string) {
  const direct = value.match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (direct) return `${direct[1]}-${direct[2].padStart(2, "0")}-${direct[3].padStart(2, "0")}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizeStatus(value: string) {
  const text = normalize(value);
  if (text.includes("review") || text.includes("검토")) return "needs_review";
  if (text.includes("archive") || text.includes("보관")) return "archived";
  if (text.includes("active") || text.includes("진행") || text.includes("활성")) return "active";
  if (text.includes("draft") || text.includes("초안")) return "draft";
  return "";
}

function normalizeSourceReliability(value: string) {
  const text = normalize(value);
  if (text.includes("primary") || text.includes("1차") || text.includes("원문") || text.includes("직접")) return "primary";
  if (text.includes("secondary") || text.includes("2차") || text.includes("해설")) return "secondary";
  if (text.includes("tertiary") || text.includes("3차") || text.includes("요약")) return "tertiary";
  if (text.includes("personal") || text.includes("개인")) return "personal";
  if (text.includes("import") || text.includes("notion") || text.includes("legacy") || text.includes("가져")) return "imported";
  if (text.includes("mixed") || text.includes("혼합")) return "mixed";
  return "unknown";
}

function normalizeReviewCadence(value: string) {
  const text = normalize(value);
  if (text.includes("week") || text.includes("주")) return "weekly";
  if (text.includes("month") || text.includes("월")) return "monthly";
  if (text.includes("quarter") || text.includes("분기")) return "quarterly";
  if (text.includes("year") || text.includes("년")) return "yearly";
  return "none";
}

function mergeTags(currentTags: string[], value: string) {
  const next = value
    .split(/[,;/\n|]+/)
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((item) => compactSingleLine(item, 40));
  const unique = new Map(currentTags.map((tag) => [tag.toLowerCase(), tag]));
  next.forEach((tag) => unique.set(tag.toLowerCase(), tag));
  return [...unique.values()];
}

function mergeAliases(currentAliases: string[], value: string) {
  const next = value
    .split(/[,;/\n|]+/)
    .map((item) => compactSingleLine(item, 80))
    .filter(Boolean);
  const unique = new Map(currentAliases.map((alias) => [alias.toLowerCase(), alias]));
  next.forEach((alias) => unique.set(alias.toLowerCase(), alias));
  return [...unique.values()];
}
