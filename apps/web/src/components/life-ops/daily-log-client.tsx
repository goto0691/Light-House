"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { DailyAutoJoinFeed } from "@/components/life-ops/daily-auto-join-feed";
import { DailyDataColumn } from "@/components/life-ops/daily-data-column";
import { DailyLogPropertiesPanel } from "@/components/life-ops/daily-log-properties-panel";
import { EnergyButtonGroup } from "@/components/life-ops/energy-button-group";
import { HabitTrackerGrid } from "@/components/life-ops/habit-tracker-grid";
import { JournalingTabs } from "@/components/life-ops/journaling-tabs";
import { MoodButtonGroup } from "@/components/life-ops/mood-button-group";
import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
import { MarkdownView } from "@/components/shared/markdown-view";
import { PageBody, PageHeader, PageLayout } from "@/components/shared/page-layout";
import { SourceDocumentPanel } from "@/components/shared/source-document-panel";
import { Tag } from "@/components/shared/tag";
import type { DailyLogMock } from "@/lib/mock/life-ops";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore, type LifeOpsMutationDelta } from "@/stores/use-life-ops-store";

const MOODS = ["😶", "🙂", "😊", "😁", "🤩"];
const ENERGIES = ["낮음", "부드러움", "안정", "집중", "고에너지"];
const DAILY_ENTRY_KIND_LABELS: Record<DailyLogMock["entries"][number]["kind"], string> = {
  journal: "일기",
  meditation: "묵상",
  sermon_note: "설교 노트",
  workout: "운동 기록",
  note: "기록",
};
type DailyScreenMode = "read" | "write" | "manage";
type DailyAsideMode = "properties" | "data" | "source" | "auto";
type DailyJournalField = "journal" | "meditation" | "gratitude";

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
  const applyMutationDelta = useLifeOpsStore((state) => state.applyMutationDelta);
  const [journalDraft, setJournalDraft] = useState("");
  const [meditationDraft, setMeditationDraft] = useState("");
  const [gratitudeDraft, setGratitudeDraft] = useState("");
  const [screenMode, setScreenMode] = useState<DailyScreenMode>("read");
  const [asideMode, setAsideMode] = useState<DailyAsideMode>("properties");

  useEffect(() => {
    if (!log) return;
    setJournalDraft(log.journal);
    setMeditationDraft(log.meditation);
    setGratitudeDraft(log.gratitude);
  }, [log]);

  useEffect(() => {
    setScreenMode("read");
    setAsideMode("properties");
  }, [date]);

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

  const saveMood = (value: number) => {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
          `/api/life-ops/logs/${date}/mood`,
          { mood: value },
          applyMutationDelta,
        );
        toast.success(`기분을 ${value}로 기록했습니다.`);
      } catch (error) {
        toast.error("기분 기록에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  const saveEnergy = (value: number) => {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
          `/api/life-ops/logs/${date}/energy`,
          { energy: value },
          applyMutationDelta,
        );
        toast.success(`에너지를 ${ENERGIES[value - 1]}로 기록했습니다.`);
      } catch (error) {
        toast.error("에너지 기록에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  const toggleHabit = (habitId: string) => {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
          `/api/life-ops/logs/${date}/habits/${habitId}/toggle`,
          undefined,
          applyMutationDelta,
        );
        const habit = log.habits.find((item) => item.id === habitId);
        toast.success(`${habit?.title ?? "습관"} 상태를 갱신했습니다.`);
      } catch (error) {
        toast.error("습관 상태 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  const saveJournalField = (field: DailyJournalField, value: string) => {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
          `/api/life-ops/logs/${date}/journal-field`,
          { field, value },
          applyMutationDelta,
        );
        toast.success(`${dailyJournalFieldLabel(field)} 저장을 완료했습니다.`);
        setScreenMode("read");
      } catch (error) {
        toast.error(`${dailyJournalFieldLabel(field)} 저장에 실패했습니다.`, {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <PageLayout>
      <DailyModeHeader log={log} mode={screenMode} onModeChange={setScreenMode} />

      {screenMode === "read" ? (
        <DailyReadMode applyMutationDelta={applyMutationDelta} disabled={isPending} log={log} />
      ) : null}

      {screenMode === "write" ? (
        <DailyWriteMode
          disabled={isPending}
          energyOptions={ENERGIES}
          gratitudeDraft={gratitudeDraft}
          journalDraft={journalDraft}
          log={log}
          meditationDraft={meditationDraft}
          moodOptions={MOODS}
          onEnergyChange={saveEnergy}
          onGratitudeChange={setGratitudeDraft}
          onHabitToggle={toggleHabit}
          onJournalChange={setJournalDraft}
          onMeditationChange={setMeditationDraft}
          onMoodChange={saveMood}
          onSaveJournalField={saveJournalField}
        />
      ) : null}

      {screenMode === "manage" ? <DailyManageMode asideMode={asideMode} heatmap={heatmap} log={log} onAsideModeChange={setAsideMode} /> : null}
    </PageLayout>
  );
}

function DailyModeHeader({ log, mode, onModeChange }: { log: DailyLogMock; mode: DailyScreenMode; onModeChange: (mode: DailyScreenMode) => void }) {
  const descriptions: Record<DailyScreenMode, string> = {
    read: "오늘의 요약, 저널, 개별 기록을 먼저 읽습니다.",
    write: "기분, 에너지, 습관, 저널만 빠르게 기록합니다.",
    manage: "속성, 원본, 자동 연결, 맥락과 히트맵을 관리합니다.",
  };

  return (
    <PageHeader
      actions={<DailyScreenModeSwitch mode={mode} onChange={onModeChange} />}
      description={descriptions[mode]}
      eyebrow="생활기록"
      meta={log.emotions.map((emotion) => (
        <Tag className="normal-case tracking-normal" key={emotion} value={emotion} variant="custom" />
      ))}
      title={log.date}
    />
  );
}

function DailyScreenModeSwitch({ mode, onChange }: { mode: DailyScreenMode; onChange: (mode: DailyScreenMode) => void }) {
  return (
    <div className="flex rounded-lg border border-white/10 bg-black/10 p-1">
      {([
        ["read", "하루 읽기"],
        ["write", "기록하기"],
        ["manage", "관리"],
      ] as const).map(([key, label]) => (
        <button
          aria-pressed={mode === key}
          className={`focus-ring min-h-10 rounded-md px-3 py-2 text-xs font-medium ${
            mode === key ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"
          }`}
          key={key}
          onClick={() => onChange(key)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DailyReadMode({
  applyMutationDelta,
  disabled,
  log,
}: {
  applyMutationDelta: (delta: LifeOpsMutationDelta) => void;
  disabled: boolean;
  log: DailyLogMock;
}) {
  return (
    <PageBody>
      <div className="space-y-4">
        <DailyReadSummary log={log} />
        <DailyJournalReadSection log={log} />
        <DailyEntriesSection applyMutationDelta={applyMutationDelta} disabled={disabled} entries={log.entries} />
      </div>
    </PageBody>
  );
}

function DailyReadSummary({ log }: { log: DailyLogMock }) {
  const completedHabits = log.habits.filter((habit) => habit.completedToday).length;

  return (
    <GlassCard priority="secondary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.08em] text-primary">하루 요약</p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">읽을 것만 먼저 봅니다</h2>
        </div>
        <span className="rounded-md border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground">기록 {log.entries.length}개</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <DailyContextMetric label="기분" value={String(log.mood)} />
        <DailyContextMetric label="에너지" value={ENERGIES[log.energy - 1] ?? String(log.energy)} />
        <DailyContextMetric label="습관" value={`${completedHabits}/${log.habits.length}`} />
        <DailyContextMetric label="딥워크" value={`${log.deepWorkMinutes}분`} />
      </div>
    </GlassCard>
  );
}

function DailyWriteMode({
  disabled,
  energyOptions,
  gratitudeDraft,
  journalDraft,
  log,
  meditationDraft,
  moodOptions,
  onEnergyChange,
  onGratitudeChange,
  onHabitToggle,
  onJournalChange,
  onMeditationChange,
  onMoodChange,
  onSaveJournalField,
}: {
  disabled: boolean;
  energyOptions: string[];
  gratitudeDraft: string;
  journalDraft: string;
  log: DailyLogMock;
  meditationDraft: string;
  moodOptions: string[];
  onEnergyChange: (value: number) => void;
  onGratitudeChange: (value: string) => void;
  onHabitToggle: (habitId: string) => void;
  onJournalChange: (value: string) => void;
  onMeditationChange: (value: string) => void;
  onMoodChange: (value: number) => void;
  onSaveJournalField: (field: DailyJournalField, value: string) => void;
}) {
  return (
    <PageBody>
      <div className="space-y-4">
        <GlassCard priority="secondary">
          <p className="text-xs tracking-[0.08em] text-primary">체크인</p>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-foreground">기분</p>
              <div className="mt-3">
                <MoodButtonGroup disabled={disabled} onChange={onMoodChange} options={moodOptions} value={log.mood} />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">에너지</p>
              <div className="mt-3">
                <EnergyButtonGroup disabled={disabled} onChange={onEnergyChange} options={energyOptions} value={log.energy} />
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard priority="secondary">
          <p className="text-xs tracking-[0.08em] text-primary">습관 트래커</p>
          <div className="mt-4">
            <HabitTrackerGrid disabled={disabled} habits={log.habits} onToggle={onHabitToggle} />
          </div>
        </GlassCard>

        <JournalingTabs
          disabled={disabled}
          gratitude={gratitudeDraft}
          journal={journalDraft}
          meditation={meditationDraft}
          meditationVerse={log.meditationVerse}
          onGratitudeChange={onGratitudeChange}
          onJournalChange={onJournalChange}
          onMeditationChange={onMeditationChange}
          onSave={onSaveJournalField}
        />
      </div>
    </PageBody>
  );
}

function DailyManageMode({
  asideMode,
  heatmap,
  log,
  onAsideModeChange,
}: {
  asideMode: DailyAsideMode;
  heatmap: Array<{ date: string; value: number }>;
  log: DailyLogMock;
  onAsideModeChange: (mode: DailyAsideMode) => void;
}) {
  return (
    <PageBody aside={<DailyAsidePanel log={log} mode={asideMode} onModeChange={onAsideModeChange} />} asideWidth="lg">
      <div className="space-y-4">
        <ContextBundlePanel
          density="page"
          enableAttach
          entityId={log.date}
          entityType="daily_log"
          mainSlot={(bundle) => (
            <div className="space-y-4">
              <section className="grid gap-3 md:grid-cols-4">
                <DailyContextMetric label="사람" value={String(bundle.grouped.people.length)} />
                <DailyContextMetric label="작업" value={String(bundle.grouped.projects.length)} />
                <DailyContextMetric label="지식" value={String(bundle.grouped.zettels.length)} />
                <DailyContextMetric label="이벤트" value={String(bundle.timeline.length)} />
              </section>
              <ContextMapMini bundle={bundle} />
            </div>
          )}
          railDefaultLens="dates"
        />

        <GlassCard priority="secondary">
          <p className="text-xs tracking-[0.08em] text-primary">연간 히트맵</p>
          <div className="mt-4">
            <Heatmap data={heatmap} />
          </div>
        </GlassCard>
      </div>
    </PageBody>
  );
}

function DailyJournalReadSection({ log }: { log: DailyLogMock }) {
  return (
    <GlassCard priority="secondary">
      <div className="grid gap-3 xl:grid-cols-3">
        <DailyReadCard title="일기" value={log.journal} />
        <DailyReadCard eyebrow={log.meditationVerse ? `본문: ${log.meditationVerse}` : undefined} title="묵상" value={log.meditation} />
        <DailyReadCard title="감사" value={log.gratitude} />
      </div>
    </GlassCard>
  );
}

function DailyReadCard({ eyebrow, title, value }: { eyebrow?: string; title: string; value: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs tracking-[0.08em] text-primary">{title}</p>
      {eyebrow ? <p className="mt-2 text-xs text-muted-foreground">{eyebrow}</p> : null}
      {value.trim() ? <MarkdownView className="mt-3 text-sm leading-6" value={value} /> : <p className="mt-3 text-sm text-muted-foreground">아직 작성된 내용이 없습니다.</p>}
    </section>
  );
}

function DailyAsidePanel({ log, mode, onModeChange }: { log: DailyLogMock; mode: DailyAsideMode; onModeChange: (mode: DailyAsideMode) => void }) {
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div>
          <p className="text-xs tracking-[0.08em] text-primary">보조 패널</p>
          <p className="mt-1 text-sm text-muted-foreground">필요한 관리 정보만 선택해서 봅니다.</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([
            ["properties", "속성"],
            ["data", "데이터"],
            ["source", "원본"],
            ["auto", "자동 연결"],
          ] as const).map(([key, label]) => (
            <button
              aria-pressed={mode === key}
              className={`focus-ring min-h-10 rounded-md border px-3 py-2 text-xs font-medium ${
                mode === key ? "border-primary/25 bg-primary/10 text-primary" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground"
              }`}
              key={key}
              onClick={() => onModeChange(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {mode === "properties" ? <DailyLogPropertiesPanel log={log} mode="edit" /> : null}
      {mode === "data" ? <DailyDataColumn deepWorkMinutes={log.deepWorkMinutes} sleepHours={log.sleepHours} /> : null}
      {mode === "source" ? (
        <div className="space-y-3">
          <DailyLogPropertiesPanel log={log} mode="source" />
          <SourceDocumentPanel canonicalEntityType="daily_log" sourceDocument={log.sourceDocument} />
        </div>
      ) : null}
      {mode === "auto" ? <DailyAutoJoinFeed items={log.timeline} /> : null}
    </div>
  );
}

function DailyEntriesSection({
  applyMutationDelta,
  disabled,
  entries,
}: {
  applyMutationDelta: (delta: LifeOpsMutationDelta) => void;
  disabled: boolean;
  entries: DailyLogMock["entries"];
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
        <span className="rounded-md border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground">{entries.length}개</span>
      </div>
      <div className="mt-4 grid gap-3">
        {entries.map((entry) => (
          <DailyEntryCard applyMutationDelta={applyMutationDelta} disabled={disabled} entry={entry} key={entry.id} />
        ))}
      </div>
    </GlassCard>
  );
}

function DailyEntryCard({
  applyMutationDelta,
  disabled,
  entry,
}: {
  applyMutationDelta: (delta: LifeOpsMutationDelta) => void;
  disabled: boolean;
  entry: DailyLogMock["entries"][number];
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
        await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
          `/api/life-ops/daily-entries/${entry.id}`,
          draft,
          applyMutationDelta,
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
    <article className="rounded-lg border border-white/10 bg-white/5 p-4">
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
          {entry.tagsSnapshot ? <span className="rounded-md border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground">{entry.tagsSnapshot}</span> : null}
          <button
            className="rounded-md border border-white/10 bg-black/10 px-3 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={disabled || isPending}
            onClick={() => setIsEditing((value) => !value)}
            type="button"
          >
            {isEditing ? "닫기" : "수정"}
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="mt-4 space-y-3 rounded-md border border-white/10 bg-black/10 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              종류
              <select
                className="mt-2 w-full rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none"
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
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
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
            <div className="mt-4 rounded-md border border-white/10 bg-black/10 p-3 text-sm text-muted-foreground">
              <p className="text-xs tracking-[0.08em] text-primary">배경</p>
              <p className="mt-2">{entry.background}</p>
            </div>
          ) : null}
        </>
      )}

      {entry.sourceDocument ? (
        <details className="mt-4 rounded-md border border-white/10 bg-black/10 p-3">
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
        className="mt-2 w-full rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none"
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
        className="mt-2 min-h-[120px] w-full resize-y rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm normal-case leading-6 tracking-normal text-foreground outline-none"
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
