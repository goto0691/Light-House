"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { WorkoutCard } from "@/components/life-ops/workout-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

export function WorkoutsClient() {
  const [isPending, startTransition] = useTransition();
  const workouts = useLifeOpsStore((state) => state.workouts);
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [categories, setCategories] = useState("");
  const [duration, setDuration] = useState(60);
  const [intensity, setIntensity] = useState(3);
  const [query, setQuery] = useState("");
  const visibleWorkouts = workouts.filter((workout) => {
    if (query && !`${workout.date} ${workout.categories} ${workout.notes}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Life Ops Workouts</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">운동 로그</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">운동 기록 추가와 목록 확인을 하나의 레이아웃 안에서 처리하는 기본 보드입니다.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{visibleWorkouts.length} workouts</span>
        </div>
      </GlassCard>

      <FilterBar filters={[]} onChange={(state) => setQuery(state.q)} searchPlaceholder="날짜, 카테고리, 메모 검색" />

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="glass rounded-[20px] p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Workout Form</p>
          <h1 className="mt-3 font-display text-3xl text-foreground">운동 추가</h1>
          <div className="mt-4 space-y-3">
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setCategories(event.target.value)} placeholder="예: 하체 · 유산소" value={categories} />
          <div className="grid gap-3 md:grid-cols-2">
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setDuration(Number(event.target.value))} type="number" value={duration} />
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" max={5} min={1} onChange={(event) => setIntensity(Number(event.target.value))} type="number" value={intensity} />
          </div>
          <button
            className="rounded-2xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                    "/api/life-ops/workouts",
                    { date, categories, duration, intensity },
                    replaceSnapshot,
                  );
                  setCategories("");
                  toast.success("운동 로그를 추가했습니다.");
                } catch (error) {
                  toast.error("운동 추가에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            운동 추가
          </button>
        </div>
        </div>

        <div className="space-y-3">
          {visibleWorkouts.length ? visibleWorkouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              onDelete={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/life-ops/workouts/${workout.id}/delete`,
                      undefined,
                      replaceSnapshot,
                    );
                  } catch (error) {
                    toast.error("운동 삭제에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              workout={workout}
            />
          )) : (
            <EmptyState description="검색 필터를 비우거나 새 운동을 추가하면 다시 흐름이 이어집니다." illustration="habit" title="표시할 운동 로그가 없습니다" />
          )}
        </div>
      </section>
    </section>
  );
}
