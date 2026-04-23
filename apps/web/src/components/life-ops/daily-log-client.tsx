"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
import { Sparkline } from "@/components/shared/sparkline";
import { ZenEditor } from "@/components/shared/zen-editor";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { getHeatmapMock } from "@/lib/mock/life-ops";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

const MOODS = ["😶", "🙂", "😊", "😁", "🤩"];
const ENERGIES = ["Low", "Soft", "Steady", "Focused", "Hyper"];

export function DailyLogClient({ date }: { date: string }) {
  const [isPending, startTransition] = useTransition();
  const log = useLifeOpsStore((state) => state.logs[date]);
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

  if (!log) return null;

  return (
    <section className="space-y-6">
      <GlassCard>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Life Ops · Daily Command Center</p>
            <h1 className="mt-3 text-3xl font-semibold">{log.date}</h1>
            <p className="mt-2 text-sm text-muted-foreground">하루의 상태, 습관, 저널링, 전 도메인 활동을 한 화면에서 정리합니다.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {MOODS.map((mood, index) => (
              <button
                className={`rounded-2xl border px-3 py-2 text-xl ${index + 1 === log.mood ? "border-primary bg-primary/15" : "border-white/10 bg-white/5"}`}
                key={mood}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/life-ops/logs/${date}/mood`,
                        { mood: index + 1 },
                        replaceSnapshot,
                      );
                      toast.success(`Mood를 ${index + 1}로 기록했습니다.`);
                    } catch (error) {
                      toast.error("Mood 기록에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                disabled={isPending}
                type="button"
              >
                {mood}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {ENERGIES.map((energy, index) => (
            <button
              className={`rounded-full px-3 py-1 text-xs ${index + 1 === log.energy ? "bg-primary/20 text-primary" : "bg-white/6 text-muted-foreground"}`}
              key={energy}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/life-ops/logs/${date}/energy`,
                      { energy: index + 1 },
                      replaceSnapshot,
                    );
                    toast.success(`Energy를 ${energy}로 기록했습니다.`);
                  } catch (error) {
                    toast.error("Energy 기록에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              disabled={isPending}
              type="button"
            >
              {energy}
            </button>
          ))}
          {log.emotions.map((emotion) => (
            <span className="rounded-full bg-white/6 px-3 py-1 text-xs text-foreground" key={emotion}>
              {emotion}
            </span>
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Habit Tracker</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {log.habits.map((habit) => (
              <button
                className={`rounded-3xl border p-4 text-left ${habit.completedToday ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5"}`}
                key={habit.id}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/life-ops/logs/${date}/habits/${habit.id}/toggle`,
                        undefined,
                        replaceSnapshot,
                      );
                      toast.success(`${habit.title} 상태를 갱신했습니다.`);
                    } catch (error) {
                      toast.error("습관 상태 저장에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                disabled={isPending}
                type="button"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{habit.icon}</span>
                  <span className="text-xs text-muted-foreground">{habit.streak} day streak</span>
                </div>
                <h2 className="mt-3 text-lg font-medium text-foreground">{habit.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{habit.completedToday ? "오늘 완료" : "오늘 아직 미기록"}</p>
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Health Snapshot</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">Sleep Hours</p>
              <Sparkline className="mt-4 h-20 w-full" data={log.sleepHours} />
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">Deep Work</p>
              <p className="mt-6 text-4xl font-semibold text-foreground">{log.deepWorkMinutes}</p>
              <p className="mt-2 text-sm text-muted-foreground">minutes today</p>
            </div>
          </div>
        </GlassCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <ZenEditor onChange={setJournalDraft} value={journalDraft} />
          <button
            className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                    `/api/life-ops/logs/${date}/journal-field`,
                    { field: "journal", value: journalDraft },
                    replaceSnapshot,
                  );
                  toast.success("Journal을 저장했습니다.");
                } catch (error) {
                  toast.error("Journal 저장에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            Journal 저장
          </button>
        </div>
        <GlassCard>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Meditation & Gratitude</p>
          <div className="mt-4 space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-primary">Verse</p>
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
                    } catch {}
                  });
                }}
                value={meditationDraft}
              />
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-primary">Gratitude</p>
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
                    } catch {}
                  });
                }}
                value={gratitudeDraft}
              />
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Year Heatmap</p>
        <div className="mt-4">
          <Heatmap data={getHeatmapMock()} />
        </div>
      </GlassCard>

      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">오늘의 연결</p>
        <div className="mt-5 space-y-3">
          {log.timeline.map((item) => (
            <div className="flex items-start gap-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-3" key={`${item.time}-${item.label}`}>
              <div className="rounded-full bg-primary/15 px-3 py-1 text-xs text-primary">{item.time}</div>
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.24em] text-muted-foreground">{item.type}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </section>
  );
}
