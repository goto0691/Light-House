import Link from "next/link";
import { AlertTriangle, CheckCircle2, Database, GitBranch, SearchCheck } from "lucide-react";

import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { getMigrationQaOverview } from "@/lib/server/settings";

type MigrationQaOverview = Awaited<ReturnType<typeof getMigrationQaOverview>>;

const SUMMARY_CARDS: Array<{
  key: keyof MigrationQaOverview["summary"];
  label: string;
  tone: "neutral" | "warning" | "success";
}> = [
  { key: "sourceDocuments", label: "Source Docs", tone: "neutral" },
  { key: "mappedDocuments", label: "Mapped", tone: "success" },
  { key: "unmappedDocuments", label: "Unmapped", tone: "warning" },
  { key: "unresolvedRelations", label: "Unresolved Relations", tone: "warning" },
  { key: "openReviewItems", label: "Open Reviews", tone: "warning" },
  { key: "duplicateSourceIds", label: "Duplicate Source IDs", tone: "warning" },
];

export function MigrationQaDashboard({ overview }: { overview: MigrationQaOverview }) {
  const hasBlockingIssues = overview.summary.unmappedDocuments > 0 || overview.summary.unresolvedRelations > 0 || overview.summary.openReviewItems > 0;

  return (
    <section className="space-y-4">
      {overview.queryErrors.length ? (
        <GlassCard className="border border-[hsl(var(--color-feedback-warning))]/30 bg-[hsl(var(--color-feedback-warning))]/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--color-feedback-warning))]" />
            <div>
              <p className="text-sm font-medium text-foreground">Migration QA 일부 쿼리가 실패했습니다.</p>
              <div className="mt-2 space-y-1">
                {overview.queryErrors.map((item) => (
                  <p className="text-xs text-muted-foreground" key={item.name}>
                    {item.name}: {item.error}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Migration QA</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">이관 점검 대시보드</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              1회성 마이그레이션 검수를 위한 내부 화면입니다. 원본 문서 매핑, 미해결 relation, review item, 중복 source id만 빠르게 확인합니다.
            </p>
          </div>
          <Tag
            icon={hasBlockingIssues ? AlertTriangle : CheckCircle2}
            value={hasBlockingIssues ? "Needs Review" : "Clear"}
            variant={hasBlockingIssues ? "status" : "custom"}
          />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {SUMMARY_CARDS.map((item) => (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4" key={item.key}>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
              <p className={item.tone === "warning" ? "mt-2 text-2xl font-semibold text-[hsl(var(--color-feedback-warning))]" : "mt-2 text-2xl font-semibold text-foreground"}>
                {overview.summary[item.key]}
              </p>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-primary">Source Databases</p>
              <h2 className="mt-3 font-display text-3xl text-foreground">DB별 매핑 상태</h2>
            </div>
            <Database className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3 font-medium">Database</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">Mapped</th>
                  <th className="py-2 pr-3 font-medium">Unmapped</th>
                  <th className="py-2 pr-3 font-medium">Relations</th>
                  <th className="py-2 font-medium">Reviews</th>
                </tr>
              </thead>
              <tbody>
                {overview.databases.map((item) => (
                  <tr className="border-b border-white/5 last:border-0" key={item.sourceDatabase}>
                    <td className="py-3 pr-3 font-medium text-foreground">{item.sourceDatabase}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{item.total}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{item.mapped}</td>
                    <td className={item.unmapped ? "py-3 pr-3 text-[hsl(var(--color-feedback-warning))]" : "py-3 pr-3 text-muted-foreground"}>{item.unmapped}</td>
                    <td className={item.unresolvedRelations ? "py-3 pr-3 text-[hsl(var(--color-feedback-warning))]" : "py-3 pr-3 text-muted-foreground"}>{item.unresolvedRelations}</td>
                    <td className={item.openReviews ? "py-3 text-[hsl(var(--color-feedback-warning))]" : "py-3 text-muted-foreground"}>{item.openReviews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-primary">Duplicate Source IDs</p>
              <h2 className="mt-3 font-display text-3xl text-foreground">중복 원본 키</h2>
            </div>
            <SearchCheck className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-5 space-y-3">
            {overview.duplicateSources.length ? (
              overview.duplicateSources.map((item) => (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3" key={`${item.sourceDatabase}:${item.sourceId}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="break-all text-sm font-medium text-foreground">{item.sourceId}</p>
                    <Tag value={`${item.count} copies`} variant="status" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.sourceDatabase ?? "Unknown"}</p>
                  {item.titles ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.titles}</p> : null}
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">중복 source id가 없습니다.</p>
            )}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Issue Documents</p>
            <h2 className="mt-3 font-display text-3xl text-foreground">먼저 확인할 원본 문서</h2>
          </div>
          <Tag icon={GitBranch} value={`${overview.sourceDocuments.length} rows`} variant="neutral" />
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Canonical</th>
                <th className="py-2 pr-3 font-medium">Props</th>
                <th className="py-2 pr-3 font-medium">Relations</th>
                <th className="py-2 pr-3 font-medium">Reviews</th>
                <th className="py-2 font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {overview.sourceDocuments.map((item) => (
                <tr className="border-b border-white/5 last:border-0" key={item.id}>
                  <td className="max-w-[320px] py-3 pr-3 align-top">
                    <p className="truncate font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 break-all text-muted-foreground">{item.sourceDatabase ?? "Unknown"} · {item.sourceId}</p>
                  </td>
                  <td className="py-3 pr-3 align-top text-muted-foreground">
                    {item.canonicalEntityType && item.canonicalEntityId ? `${item.canonicalEntityType}:${item.canonicalEntityId}` : "unmapped"}
                  </td>
                  <td className="py-3 pr-3 align-top text-muted-foreground">{item.propertyCount}</td>
                  <td className={item.unresolvedRelations ? "py-3 pr-3 align-top text-[hsl(var(--color-feedback-warning))]" : "py-3 pr-3 align-top text-muted-foreground"}>{item.unresolvedRelations}</td>
                  <td className={item.openReviews ? "py-3 pr-3 align-top text-[hsl(var(--color-feedback-warning))]" : "py-3 pr-3 align-top text-muted-foreground"}>{item.openReviews}</td>
                  <td className="py-3 align-top">
                    {item.canonicalEntityType && item.canonicalEntityId ? (
                      <Link className="text-primary underline-offset-4 hover:underline" href={canonicalHref(item.canonicalEntityType, item.canonicalEntityId)}>
                        Context
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Review Items</p>
        <h2 className="mt-3 font-display text-3xl text-foreground">Migration review queue</h2>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {overview.reviewItems.length ? (
            overview.reviewItems.map((item) => (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4" key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground">{item.issueType}</h3>
                  <Tag value={item.status} variant="status" />
                </div>
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {item.sourceDatabase ?? item.entityType}
                  {item.sourceTitle ? ` · ${item.sourceTitle}` : ""}
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.suggestedAction}</p>
                {item.reason ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.reason}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.confidence !== null ? <Tag value={`confidence ${Math.round(item.confidence * 100)}%`} variant="neutral" /> : null}
                  {item.entityId ? <Tag value={`${item.entityType}:${item.entityId.slice(0, 8)}`} variant="neutral" /> : <Tag value={item.entityType} variant="neutral" />}
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">리뷰 큐가 비어 있습니다.</p>
          )}
        </div>
      </GlassCard>
    </section>
  );
}

function canonicalHref(type: string, id: string) {
  switch (type) {
    case "person":
      return `/prm/${id}`;
    case "task":
      return `/action-hub?detail=task:${id}`;
    case "project":
      return `/action-hub/${id}`;
    case "zettel":
      return `/vault/zettels/${id}`;
    case "media":
      return `/vault/media?detail=media:${id}`;
    case "place":
      return `/vault/places?detail=place:${id}`;
    case "daily_log":
      return `/life-ops/${id}`;
    default:
      return "/settings/data";
  }
}
