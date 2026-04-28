import Link from "next/link";

import { CollectionShell } from "@/components/shared/collection-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownView } from "@/components/shared/markdown-view";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import { SourceDocumentPanel } from "@/components/shared/source-document-panel";
import type { DailyEntry } from "@/lib/mock/life-ops";
import { getDailyEntryArchive } from "@/lib/server/life-ops";
import { listSavedViews, type SavedView } from "@/lib/server/ui-state";

type DailyEntriesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const DAILY_ENTRY_KINDS = ["journal", "meditation", "sermon_note", "workout", "note"] as const satisfies readonly DailyEntry["kind"][];

const KIND_LABELS: Record<DailyEntry["kind"], string> = {
  journal: "Journal",
  meditation: "Meditation",
  sermon_note: "Sermon Note",
  workout: "Workout",
  note: "Note",
};

export default async function DailyEntriesPage({ searchParams }: DailyEntriesPageProps) {
  const params = (await searchParams) ?? {};
  const views = await listSavedViews({ domain: "daily", scope: "entries" });
  const activeViewKey = getStringParam(params.view) ?? views.find((view) => view.isDefault)?.viewKey ?? views[0]?.viewKey ?? "calendar";
  const activeView = views.find((view) => view.viewKey === activeViewKey) ?? views.find((view) => view.isDefault) ?? views[0];
  const entries = await getDailyEntryArchive();
  const visibleEntries = activeView ? applyDailyEntryView(entries, activeView) : entries;
  const kindCount = new Set(visibleEntries.map((entry) => entry.kind)).size;
  const peopleLinkCount = visibleEntries.reduce((count, entry) => count + (entry.people?.length ?? 0), 0);

  return (
    <CollectionShell
      aside={<DailyEntryLens activeView={activeView} entries={visibleEntries} />}
      asideWidth="md"
      description="AS-IS의 일기, 묵상, 설교 노트, 운동 기록을 날짜 컨테이너에 가두지 않고 속성 기반 컬렉션으로 다시 엮습니다."
      eyebrow="Life Ops"
      metrics={[
        { label: "Visible", value: visibleEntries.length },
        { label: "All Entries", value: entries.length },
        { label: "Entry Types", value: kindCount },
        { label: "People Links", value: peopleLinkCount },
      ]}
      title="Daily Entries"
      toolbar={<SavedViewTabs activeViewKey={activeView?.viewKey ?? activeViewKey} basePath="/life-ops/entries" views={views} />}
    >
      <div className="grid gap-4">
        {visibleEntries.length ? (
          visibleEntries.map((entry) => <DailyEntryArchiveCard entry={entry} key={entry.id} />)
        ) : (
          <EmptyState
            description="현재 saved view 조건에 맞는 기록이 없습니다. 다른 view를 선택하거나 데이터 설정에서 컬렉션 상태를 확인하세요."
            title="표시할 Daily Entry가 없습니다."
          />
        )}
      </div>
    </CollectionShell>
  );
}

function getStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isDailyEntryKind(value: unknown): value is DailyEntry["kind"] {
  return typeof value === "string" && DAILY_ENTRY_KINDS.includes(value as DailyEntry["kind"]);
}

function getKindFilter(view: SavedView) {
  const raw = view.filterState.kind;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.filter(isDailyEntryKind);
}

function applyDailyEntryView(entries: DailyEntry[], view: SavedView) {
  const kindFilter = getKindFilter(view);
  let filtered = kindFilter.length ? entries.filter((entry) => kindFilter.includes(entry.kind)) : entries;

  if (view.viewKey === "people-mentions") {
    filtered = entries.filter((entry) => (entry.people?.length ?? 0) > 0);
  }

  if (view.viewKey === "emotion-timeline") {
    filtered = entries.filter((entry) => Boolean(entry.emotion?.trim()));
  }

  return filtered.sort((left, right) => {
    const dateSort = right.date.localeCompare(left.date);
    if (dateSort !== 0) return dateSort;
    return left.title.localeCompare(right.title);
  });
}

function DailyEntryLens({ activeView, entries }: { activeView?: SavedView; entries: DailyEntry[] }) {
  const kindCounts = DAILY_ENTRY_KINDS.map((kind) => ({
    kind,
    count: entries.filter((entry) => entry.kind === kind).length,
  })).filter((item) => item.count > 0);
  const latestDate = entries[0]?.date ?? "-";
  const oldestDate = entries[entries.length - 1]?.date ?? "-";

  return (
    <div className="space-y-4">
      <GlassCard priority="secondary">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Current View</p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{activeView?.name ?? "Daily Entries"}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          이 화면은 별도 전용 페이지가 아니라 saved view 조건으로 같은 데이터 컬렉션을 재배열합니다.
        </p>
        <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2">
            <span>Latest</span>
            <span className="font-medium text-foreground">{latestDate}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2">
            <span>Oldest</span>
            <span className="font-medium text-foreground">{oldestDate}</span>
          </div>
        </div>
      </GlassCard>

      <GlassCard priority="secondary">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Kind Distribution</p>
        <div className="mt-3 space-y-2">
          {kindCounts.length ? (
            kindCounts.map((item) => (
              <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm" key={item.kind}>
                <span className="text-muted-foreground">{KIND_LABELS[item.kind]}</span>
                <span className="font-semibold text-foreground">{item.count}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">분포를 계산할 기록이 없습니다.</p>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function DailyEntryArchiveCard({ entry }: { entry: DailyEntry }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-primary">
              {KIND_LABELS[entry.kind]}
            </span>
            <span className="text-sm text-muted-foreground">{entry.date}</span>
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">{entry.title}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {entry.emotion ? <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">감정: {entry.emotion}</span> : null}
            {entry.eventSummary ? <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">사건: {entry.eventSummary}</span> : null}
            {entry.verse ? <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">본문: {entry.verse}</span> : null}
            {entry.tagsSnapshot ? <span className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1">태그: {entry.tagsSnapshot}</span> : null}
          </div>
        </div>
        <Link className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground" href={`/life-ops/${entry.date}`}>
          날짜 로그 보기
        </Link>
      </div>

      {entry.people?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {entry.people.map((person) => (
            <Link className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground" href={`/prm/${person.id}`} key={person.id}>
              {person.name}
            </Link>
          ))}
        </div>
      ) : null}

      {entry.body ? (
        <div className="mt-4 max-h-[30rem] overflow-y-auto rounded-md border border-white/10 bg-black/10 p-4">
          <MarkdownView value={entry.body} />
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-white/10 bg-black/10 p-4 text-sm text-muted-foreground">본문이 비어 있습니다.</p>
      )}

      {entry.background ? (
        <div className="mt-4 rounded-md border border-white/10 bg-black/10 p-4 text-sm leading-6 text-muted-foreground">
          <p className="text-xs uppercase tracking-[0.16em] text-primary">Background</p>
          <p className="mt-2 whitespace-pre-wrap">{entry.background}</p>
        </div>
      ) : null}

      {entry.sourceDocument ? (
        <details className="mt-4 rounded-md border border-white/10 bg-black/10 p-4">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-muted-foreground">Record Properties</summary>
          <div className="mt-3">
            <SourceDocumentPanel sourceDocument={entry.sourceDocument} />
          </div>
        </details>
      ) : null}
    </article>
  );
}
