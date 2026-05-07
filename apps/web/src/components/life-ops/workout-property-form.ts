import type { WorkoutLog } from "@/lib/mock/life-ops";

export type WorkoutPropertyForm = {
  date: string;
  categories: string;
  duration: string;
  intensity: string;
  notes: string;
};

export function buildWorkoutPropertyForm(workout?: Partial<WorkoutLog>): WorkoutPropertyForm {
  return {
    date: workout?.date ?? new Date().toISOString().slice(0, 10),
    categories: workout?.categories ?? "",
    duration: String(workout?.duration ?? 60),
    intensity: String(workout?.intensity ?? 3),
    notes: workout?.notes ?? "",
  };
}

export function workoutPropertyPayload(form: WorkoutPropertyForm) {
  return {
    date: form.date,
    categories: form.categories.trim(),
    duration: numberFromForm(form.duration, 0),
    intensity: numberFromForm(form.intensity, 3),
    notes: form.notes.trim(),
  };
}

function numberFromForm(value: string, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}
