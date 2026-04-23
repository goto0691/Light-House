"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { DailyAutoJoinFeed } from "@/components/life-ops/daily-auto-join-feed";
import { DailyDataColumn } from "@/components/life-ops/daily-data-column";
import { DailyTopStrip } from "@/components/life-ops/daily-top-strip";
import { HabitTrackerGrid } from "@/components/life-ops/habit-tracker-grid";
import { JournalingTabs } from "@/components/life-ops/journaling-tabs";
import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
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
  const [sleepDraft, setSleepDraft] = useState(7);
  const [deepWorkDraft, setDeepWorkDraft] = useState(0);

  useEffect(() => {
    if (!log) return;
    setJournalDraft(log.journal);
    setMeditationDraft(log.meditation);
    setGratitudeDraft(log.gratitude);
    setSleepDraft(Number(log.sleepHours[log.sleepHours.length - 1] ?? 7));
    setDeepWorkDraft(log.deepWorkMinutes);
  }, [log]);

  if (!log) return null;

  return (
    <section className="space-y-6">
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
              toast.success(`Energy를 ${ENERGIES[value - 1]}로 기록했습니다.`);
            } catch (error) {
              toast.error("Energy 기록에 실패했습니다.", {
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
              toast.success(`Mood를 ${value}로 기록했습니다.`);
            } catch (error) {
              toast.error("Mood 기록에 실패했습니다.", {
                description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
              });
            }
          });
        }}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard className="p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Habit Tracker</p>
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

        <DailyDataColumn
          deepWorkDraft={deepWorkDraft}
          deepWorkMinutes={log.deepWorkMinutes}
          disabled={isPending}
          onDeepWorkDraftChange={setDeepWorkDraft}
          onSave={() => {
            startTransition(async () => {
              try {
                await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                  "/api/life-ops/health-metrics",
                  { date, sleepHours: sleepDraft, deepWorkMinutes: deepWorkDraft },
                  replaceSnapshot,
                );
                toast.success("Health metrics를 저장했습니다.");
              } catch (error) {
                toast.error("Health metrics 저장에 실패했습니다.", {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
          onSleepDraftChange={setSleepDraft}
          sleepDraft={sleepDraft}
          sleepHours={log.sleepHours}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
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
                toast.success(`${field} 저장을 완료했습니다.`);
              } catch (error) {
                toast.error(`${field} 저장에 실패했습니다.`, {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
        />
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

      <DailyAutoJoinFeed items={log.timeline} />
    </section>
  );
}
