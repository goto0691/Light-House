"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { WorkoutCard } from "@/components/life-ops/workout-card";
import { buildWorkoutPropertyForm, workoutPropertyPayload, type WorkoutPropertyForm } from "@/components/life-ops/workout-property-form";
import { WORKOUT_PROPERTY_DEFINITIONS, WORKOUT_PROPERTY_GROUPS } from "@/lib/properties/workout";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore, type LifeOpsMutationDelta } from "@/stores/use-life-ops-store";

export function WorkoutsClient() {
  const [isPending, startTransition] = useTransition();
  const workouts = useLifeOpsStore((state) => state.workouts);
  const applyMutationDelta = useLifeOpsStore((state) => state.applyMutationDelta);
  const [workoutForm, setWorkoutForm] = useState<WorkoutPropertyForm>(() => buildWorkoutPropertyForm());
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
            <p className="text-xs text-primary">생활기록 · 운동</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">운동 로그</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">운동 기록 추가와 목록 확인을 하나의 레이아웃 안에서 처리하는 기본 보드입니다.</p>
          </div>
        <span className="rounded-md border border-white/10 bg-black/10 px-4 py-2 text-xs text-muted-foreground">{visibleWorkouts.length}개</span>
        </div>
      </GlassCard>

      <FilterBar filters={[]} onChange={(state) => setQuery(state.q)} searchPlaceholder="날짜, 카테고리, 메모 검색" />

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          <section className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-primary">운동 만들기</p>
            <h1 className="mt-2 font-display text-3xl text-foreground">새 운동</h1>
          </section>
          <PropertyPanel
            definitions={WORKOUT_PROPERTY_DEFINITIONS}
            form={workoutForm}
            groups={WORKOUT_PROPERTY_GROUPS}
            onChange={(patch) => setWorkoutForm((current) => ({ ...current, ...patch }))}
            title="새 운동 속성"
          />
          <button
            className="focus-ring rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={isPending || !workoutForm.categories.trim()}
            onClick={() => {
              startTransition(async () => {
                try {
                  const payload = workoutPropertyPayload(workoutForm);
                  await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
                    "/api/life-ops/workouts",
                    payload,
                    applyMutationDelta,
                  );
                  setWorkoutForm({ ...buildWorkoutPropertyForm(), date: workoutForm.date });
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

        <div className="space-y-3">
          {visibleWorkouts.length ? visibleWorkouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              onDelete={() => {
                startTransition(async () => {
                  try {
                    await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
                      `/api/life-ops/workouts/${workout.id}/delete`,
                      undefined,
                      applyMutationDelta,
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
