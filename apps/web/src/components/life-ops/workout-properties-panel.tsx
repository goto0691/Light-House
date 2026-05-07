"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { buildWorkoutPropertyForm, workoutPropertyPayload, type WorkoutPropertyForm } from "@/components/life-ops/workout-property-form";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import type { WorkoutLog } from "@/lib/mock/life-ops";
import { WORKOUT_PROPERTY_DEFINITIONS, WORKOUT_PROPERTY_GROUPS } from "@/lib/properties/workout";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

type WorkoutPropertiesPanelProps = {
  workout: WorkoutLog;
};

export function WorkoutPropertiesPanel({ workout }: WorkoutPropertiesPanelProps) {
  const [isPending, startTransition] = useTransition();
  const activeWorkout = useLifeOpsStore((state) => state.workouts.find((item) => item.id === workout.id)) ?? workout;
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const [form, setForm] = useState<WorkoutPropertyForm>(() => buildWorkoutPropertyForm(activeWorkout));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedWorkoutId, setSyncedWorkoutId] = useState(activeWorkout.id);

  useEffect(() => {
    if (isDirty && activeWorkout.id === syncedWorkoutId) return;
    setForm(buildWorkoutPropertyForm(activeWorkout));
    setSyncedWorkoutId(activeWorkout.id);
    setIsDirty(false);
  }, [activeWorkout, isDirty, syncedWorkoutId]);

  const updateForm = (patch: Partial<WorkoutPropertyForm>) => {
    setIsDirty(true);
    setForm((current) => ({ ...current, ...patch }));
  };

  const saveProperties = () => {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/life-ops/workouts/${activeWorkout.id}/properties`,
          workoutPropertyPayload(form),
          replaceSnapshot,
        );
        setIsDirty(false);
        toast.success("운동 속성을 저장했습니다.");
      } catch (error) {
        toast.error("운동 속성 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">운동 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">날짜, 분류, 시간, 강도, 메모를 같은 문법으로 편집합니다.</p>
          </div>
          <button
            className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={isPending || !form.categories.trim()}
            onClick={saveProperties}
            type="button"
          >
            {isPending ? "저장 중..." : "속성 저장"}
          </button>
        </div>
      </section>
      <PropertyPanel definitions={WORKOUT_PROPERTY_DEFINITIONS} form={form} groups={WORKOUT_PROPERTY_GROUPS} onChange={updateForm} />
    </div>
  );
}
