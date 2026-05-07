import type { HabitDefinition } from "@/lib/mock/life-ops";

export type HabitPropertyForm = {
  title: string;
  description: string;
  icon: string;
  schedule: string;
  isActive: boolean;
};

export function buildHabitPropertyForm(habit?: Partial<HabitDefinition>): HabitPropertyForm {
  return {
    title: habit?.title ?? "",
    description: habit?.description ?? "",
    icon: habit?.icon ?? "•",
    schedule: habit?.schedule ?? "daily",
    isActive: habit?.isActive ?? true,
  };
}

export function habitPropertyPayload(form: HabitPropertyForm) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    icon: form.icon.trim() || "•",
    schedule: form.schedule.trim() || "daily",
    isActive: form.isActive,
  };
}
