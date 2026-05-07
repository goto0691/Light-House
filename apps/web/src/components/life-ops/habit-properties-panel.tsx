"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { buildHabitPropertyForm, habitPropertyPayload, type HabitPropertyForm } from "@/components/life-ops/habit-property-form";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import type { HabitDefinition } from "@/lib/mock/life-ops";
import { HABIT_PROPERTY_DEFINITIONS, HABIT_PROPERTY_GROUPS } from "@/lib/properties/habit";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

type HabitPropertiesPanelProps = {
  habit: HabitDefinition;
};

export function HabitPropertiesPanel({ habit }: HabitPropertiesPanelProps) {
  const [isPending, startTransition] = useTransition();
  const activeHabit = useLifeOpsStore((state) => state.habits.find((item) => item.id === habit.id)) ?? habit;
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const [form, setForm] = useState<HabitPropertyForm>(() => buildHabitPropertyForm(activeHabit));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedHabitId, setSyncedHabitId] = useState(activeHabit.id);

  useEffect(() => {
    if (isDirty && activeHabit.id === syncedHabitId) return;
    setForm(buildHabitPropertyForm(activeHabit));
    setSyncedHabitId(activeHabit.id);
    setIsDirty(false);
  }, [activeHabit, isDirty, syncedHabitId]);

  const updateForm = (patch: Partial<HabitPropertyForm>) => {
    setIsDirty(true);
    setForm((current) => ({ ...current, ...patch }));
  };

  const saveProperties = () => {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/life-ops/habits/${activeHabit.id}/properties`,
          habitPropertyPayload(form),
          replaceSnapshot,
        );
        setIsDirty(false);
        toast.success("습관 속성을 저장했습니다.");
      } catch (error) {
        toast.error("습관 속성 저장에 실패했습니다.", {
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
            <p className="text-xs tracking-[0.08em] text-primary">습관 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">이름, 반복 규칙, 활성 상태를 한 자리에서 조정합니다.</p>
          </div>
          <button
            className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={isPending || !form.title.trim()}
            onClick={saveProperties}
            type="button"
          >
            {isPending ? "저장 중..." : "속성 저장"}
          </button>
        </div>
      </section>
      <PropertyPanel definitions={HABIT_PROPERTY_DEFINITIONS} form={form} groups={HABIT_PROPERTY_GROUPS} onChange={updateForm} />
    </div>
  );
}
