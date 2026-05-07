"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { DailyAutoJoinFeed } from "@/components/life-ops/daily-auto-join-feed";
import { DailyDataColumn } from "@/components/life-ops/daily-data-column";
import { DailyLogPropertiesPanel } from "@/components/life-ops/daily-log-properties-panel";
import { DailyTopStrip } from "@/components/life-ops/daily-top-strip";
import { HabitTrackerGrid } from "@/components/life-ops/habit-tracker-grid";
import { JournalingTabs } from "@/components/life-ops/journaling-tabs";
import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
import { MarkdownView } from "@/components/shared/markdown-view";
import { PageBody, PageLayout } from "@/components/shared/page-layout";
import { SourceDocumentPanel } from "@/components/shared/source-document-panel";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import type { DailyLogMock } from "@/lib/mock/life-ops";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

const MOODS = ["😶", "🙂", "😊", "😁", "🤩"];
const ENERGIES = ["낮음", "부드러움", "안정", "집중", "고에너지"];
const DAILY_ENTRY_KIND_LABELS: Record<DailyLogMock["entries"][number]["kind"], string> = {
  journal: "일기",
  meditation: "묵상",
  sermon_note: "설교 노트",
  workout: "운동 기록",
  note: "기록",
};
type LifeOpsSnapshotState = Parameters<ReturnType<typeof useLifeOpsStore.getState>["replaceSnapshot"]>[0];

export function DailyLogClient({
  date,
  heatmap,
  initialLog,
}: {
  date: string;
  heatmap: Array<{ date: string; value: number }>;
  initialLog: DailyLogMock | null;
}) {
  const [isPending, startTransition] = useTransition();
  const storeLog = useLifeOpsStore((state) => state.logs[date]);
  const log = storeLog ?? initialLog;
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const [journalDraft, setJournalDraft] = useState("");
  const [meditationDraft, setMeditationDraft] = useState("");
  const [gratitudeDraft, setGratitudeDraft] = useState("");

  useEffect(() => {
    if (!log) return;
    setJournalDraft(log.journal);
    setMeditationDraft(log.meditation);
    setGratitudeDraft(log.gratitude);
  }, [log]);

  if (!log) {
    return (
      <PageLayout>
        <GlassCard>
          <p className="text-xs tracking-[0.08em] text-muted-foreground">일일 로그</p>
          <h1 className="mt-3 font-display text-2xl text-foreground">{date}</h1>
          <p className="mt-2 text-sm text-muted-foreground">이 날짜의 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        </GlassCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <DailyTopStrip
        date={log.date}
        disabled={isPending}
        emotions={log.emotions}
        energy={log.energy}
        energyOptions={ENERGIES}
        mood={log.mood}
        moodOptions={MOODS}
        onEnergyChange={(value) => {
          startTransition(async () => {
            try {
              await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                `/api/life-ops/logs/${date}/energy`,
                { energy: value },
                replaceSnapshot,
              );
              toast.success(`에너지를 ${ENERGIES[value - 1]}로 기록했습니다.`);
            } catch (error) {
              toast.error("에너지 기록에 실패했습니다.", {
                description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
              });
            }
          });
        }}
        onMoodChange={(value) => {
          startTransition(async () => {
            try {
              await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                `/api/life-ops/logs/${date}/mood`,
                { mood: value },
                replaceSnapshot,
              );
              toast.success(`기분을 ${value}로 기록했습니다.`);
            } catch (error) {
              toast.error("기분 기록에 실패했습니다.", {
                description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
              });
            }
          });
        }}
      />

      <PageBody
        aside={
          <div className="space-y-4">
            <DailyLogPropertiesPanel log={log} />
            <DailyDataColumn
              deepWorkMinutes={log.deepWorkMinutes}
              sleepHours={log.sleepHours}
            />
            <DailyAutoJoinFeed items={log.timeline} />
            <SourceDocumentPanel canonicalEntityType="daily_log" sourceDocument={log.sourceDocument} />
          </div>
        }
        asideWidth="lg"
      >
        <div className="space-y-4">
          <GlassCard priority="secondary">
            <p className="text-xs tracking-[0.08em] text-muted-foreground">습관 트래커</p>
            <div className="mt-4">
              <HabitTrackerGrid
                disabled={isPending}
                habits={log.habits}
                onToggle={(habitId) => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/life-ops/logs/${date}/habits/${habitId}/toggle`,
                        undefined,
                        replaceSnapshot,
                      );
                      const habit = log.habits.find((item) => item.id === habitId);
                      toast.success(`${habit?.title ?? "습관"} 상태를 갱신했습니다.`);
                    } catch (error) {
                      toast.error("습관 상태 저장에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
              />
            </div>
          </GlassCard>

        <JournalingTabs
          disabled={isPending}
          gratitude={gratitudeDraft}
          journal={journalDraft}
          meditation={meditationDraft}
          meditationVerse={log.meditationVerse}
          onGratitudeChange={setGratitudeDraft}
          onJournalChange={setJournalDraft}
          onMeditationChange={setMeditationDraft}
          onSave={(field, value) => {
            startTransition(async () => {
              try {
                await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                  `/api/life-ops/logs/${date}/journal-field`,
                  { field, value },
                  replaceSnapshot,
                );
                toast.success(`${dailyJournalFieldLabel(field)} 저장을 완료했습니다.`);
              } catch (error) {
                toast.error(`${dailyJournalFieldLabel(field)} 저장에 실패했습니다.`, {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
        />
        <DailyEntriesSection disabled={isPending} entries={log.entries} replaceSnapshot={replaceSnapshot} />
        <GlassCard priority="secondary">
          <p className="text-xs tracking-[0.08em] text-muted-foreground">묵상과 감사</p>
          <div className="mt-4 space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs tracking-[0.08em] text-primary">본문 말씀</p>
              <p className="mt-2 text-lg text-foreground">{log.meditationVerse}</p>
              <textarea
                className="mt-3 min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/10 p-3 text-sm text-foreground outline-none"
                onChange={(event) => setMeditationDraft(event.target.value)}
                onBlur={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/life-ops/logs/${date}/journal-field`,
                        { field: "meditation", value: meditationDraft },
                        replaceSnapshot,
                      );
                      toast.success("묵상 저장을 완료했습니다.");
                    } catch (error) {
                      toast.error("묵상 저장에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                value={meditationDraft}
              />
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs tracking-[0.08em] text-primary">감사</p>
              <textarea
                className="mt-3 min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/10 p-3 text-sm text-foreground outline-none"
                onChange={(event) => setGratitudeDraft(event.target.value)}
                onBlur={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/life-ops/logs/${date}/journal-field`,
                        { field: "gratitude", value: gratitudeDraft },
                        replaceSnapshot,
                      );
                      toast.success("감사 저장을 완료했습니다.");
                    } catch (error) {
                      toast.error("감사 저장에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                value={gratitudeDraft}
              />
            </div>
          </div>
        </GlassCard>
        </div>

      </PageBody>

      <ContextBundlePanel
        density="page"
        enableAttach
        entityId={date}
        entityType="daily_log"
        mainSlot={(bundle) => (
          <div className="space-y-4">
            <section className="grid gap-3 md:grid-cols-4">
              <DailyContextMetric label="사람" value={String(bundle.grouped.people.length)} />
              <DailyContextMetric label="작업" value={String(bundle.grouped.projects.length)} />
              <DailyContextMetric label="노트" value={String(bundle.grouped.zettels.length)} />
              <DailyContextMetric label="이벤트" value={String(bundle.timeline.length)} />
            </section>
            <ContextMapMini bundle={bundle} />
          </div>
        )}
        railDefaultLens="dates"
      />

      <GlassCard priority="secondary">
        <p className="text-xs tracking-[0.08em] text-muted-foreground">연간 히트맵</p>
        <div className="mt-4">
          <Heatmap data={heatmap} />
        </div>
      </GlassCard>
    </PageLayout>
  );
}

function DailyEntriesSection({
  disabled,
  entries,
  replaceSnapshot,
}: {
  disabled: boolean;
  entries: DailyLogMock["entries"];
  replaceSnapshot: (snapshot: LifeOpsSnapshotState) => void;
}) {
  if (!entries.length) {
    return (
      <GlassCard priority="secondary">
        <p className="text-xs tracking-[0.08em] text-muted-foreground">개별 기록</p>
        <p className="mt-3 text-sm text-muted-foreground">이 날짜에 연결된 개별 일기/묵상 기록이 없습니다.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard priority="secondary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.08em] text-muted-foreground">개별 기록</p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">개별 일기와 묵상</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground">{entries.length}개</span>
      </div>
      <div className="mt-4 grid gap-3">
        {entries.map((entry) => (
          <DailyEntryCard disabled={disabled} entry={entry} key={entry.id} replaceSnapshot={replaceSnapshot} />
        ))}
      </div>
    </GlassCard>
  );
}

function DailyEntryCard({
  disabled,
  entry,
  replaceSnapshot,
}: {
  disabled: boolean;
  entry: DailyLogMock["entries"][number];
  replaceSnapshot: (snapshot: LifeOpsSnapshotState) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState({
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    emotion: entry.emotion ?? "",
    eventSummary: entry.eventSummary ?? "",
    verse: entry.verse ?? "",
    background: entry.background ?? "",
    tagsSnapshot: entry.tagsSnapshot ?? "",
  });

  useEffect(() => {
    setDraft({
      kind: entry.kind,
      title: entry.title,
      body: entry.body,
      emotion: entry.emotion ?? "",
      eventSummary: entry.eventSummary ?? "",
      verse: entry.verse ?? "",
      background: entry.background ?? "",
      tagsSnapshot: entry.tagsSnapshot ?? "",
    });
  }, [entry]);

  const saveEntry = () => {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: LifeOpsSnapshotState }, LifeOpsSnapshotState>(
          `/api/life-ops/daily-entries/${entry.id}`,
          draft,
          replaceSnapshot,
        );
        setIsEditing(false);
        toast.success("개별 기록을 저장했습니다.");
      } catch (error) {
        toast.error("개별 기록 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <article className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.08em] text-primary">{DAILY_ENTRY_KIND_LABELS[entry.kind]}</p>
          <h3 className="mt-2 text-lg font-semibold text-foreground">{entry.title}</h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {entry.emotion ? <span>감정: {entry.emotion}</span> : null}
            {entry.eventSummary ? <span>사건: {entry.eventSummary}</span> : null}
            {entry.verse ? <span>본문: {entry.verse}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {entry.tagsSnapshot ? <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground">{entry.tagsSnapshot}</span> : null}
          <button
            className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            disabled={disabled || isPending}
            onClick={() => setIsEditing((value) => !value)}
            type="button"
          >
            {isEditing ? "닫기" : "수정"}
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/10 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              종류
              <select
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none"
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as DailyLogMock["entries"][number]["kind"] })}
                value={draft.kind}
              >
                <option value="journal">일기</option>
                <option value="meditation">묵상</option>
                <option value="sermon_note">설교 노트</option>
                <option value="workout">운동 기록</option>
                <option value="note">기록</option>
              </select>
            </label>
            <EntryField label="제목" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
            <EntryField label="감정" value={draft.emotion} onChange={(emotion) => setDraft({ ...draft, emotion })} />
            <EntryField label="사건 요약" value={draft.eventSummary} onChange={(eventSummary) => setDraft({ ...draft, eventSummary })} />
            <EntryField label="본문/구절" value={draft.verse} onChange={(verse) => setDraft({ ...draft, verse })} />
            <EntryField label="태그 스냅샷" value={draft.tagsSnapshot} onChange={(tagsSnapshot) => setDraft({ ...draft, tagsSnapshot })} />
          </div>
          <EntryTextArea label="본문" value={draft.body} onChange={(body) => setDraft({ ...draft, body })} />
          <EntryTextArea label="배경" value={draft.background} onChange={(background) => setDraft({ ...draft, background })} />
          <button
            className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={disabled || isPending}
            onClick={saveEntry}
            type="button"
          >
            개별 기록 저장
          </button>
        </div>
      ) : (
        <>
          {entry.body ? <MarkdownView className="mt-4" value={entry.body} /> : <p className="mt-4 text-sm text-muted-foreground">본문이 비어 있습니다.</p>}
          {entry.background ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-3 text-sm text-muted-foreground">
              <p className="text-xs tracking-[0.08em] text-primary">배경</p>
              <p className="mt-2">{entry.background}</p>
            </div>
          ) : null}
        </>
      )}

      {entry.sourceDocument ? (
        <details className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-muted-foreground">속성 보기</summary>
          <div className="mt-3">
            <SourceDocumentPanel canonicalEntityType={entry.id.includes(":") ? "daily_log" : "daily_entry"} sourceDocument={entry.sourceDocument} />
          </div>
        </details>
      ) : null}
    </article>
  );
}

function EntryField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <input
        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function EntryTextArea({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <textarea
        className="mt-2 min-h-[120px] w-full resize-y rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case leading-6 tracking-normal text-foreground outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function DailyContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function dailyJournalFieldLabel(field: "journal" | "meditation" | "gratitude") {
  if (field === "journal") return "일기";
  if (field === "meditation") return "묵상";
  return "감사";
}
