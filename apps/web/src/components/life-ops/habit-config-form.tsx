"use client";

import { useState } from "react";

import { buildHabitPropertyForm, habitPropertyPayload, type HabitPropertyForm } from "@/components/life-ops/habit-property-form";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { HABIT_PROPERTY_DEFINITIONS, HABIT_PROPERTY_GROUPS } from "@/lib/properties/habit";

type HabitConfigFormProps = {
  disabled?: boolean;
  onSubmit: (input: { title: string; description: string; icon: string; schedule: string }) => void;
};

const HABIT_CREATE_DEFINITIONS = HABIT_PROPERTY_DEFINITIONS.filter((definition) => definition.field !== "isActive");

export function HabitConfigForm({ disabled, onSubmit }: HabitConfigFormProps) {
  const [form, setForm] = useState<HabitPropertyForm>(() => buildHabitPropertyForm());

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-primary">습관 만들기</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">새 습관</h1>
      </section>
      <PropertyPanel
        definitions={HABIT_CREATE_DEFINITIONS}
        form={form}
        groups={HABIT_PROPERTY_GROUPS}
        onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        title="새 습관 속성"
      />
      <button
        className="focus-ring rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        disabled={disabled || !form.title.trim()}
        onClick={() => {
          const payload = habitPropertyPayload(form);
          onSubmit({
            title: payload.title,
            description: payload.description,
            icon: payload.icon,
            schedule: payload.schedule,
          });
          setForm(buildHabitPropertyForm());
        }}
        type="button"
      >
        습관 추가
      </button>
    </div>
  );
}
