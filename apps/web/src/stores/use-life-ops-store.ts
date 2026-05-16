"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getDailyLogMock, getTodayString, type CareerLog, type DailyLogMock, type HabitDefinition, type HealthMetric, type WorkoutLog } from "@/lib/mock/life-ops";

export type LifeOpsMutationDelta = {
  careerEntry?: CareerLog;
  dailyLog?: DailyLogMock;
  deletedCareerId?: string;
  deletedWorkoutId?: string;
  habit?: HabitDefinition;
  healthMetrics?: HealthMetric[];
  workout?: WorkoutLog;
};

type LifeOpsState = {
  logs: Record<string, DailyLogMock>;
  habits: HabitDefinition[];
  workouts: WorkoutLog[];
  career: CareerLog[];
  healthMetrics: HealthMetric[];
  applyMutationDelta: (delta: LifeOpsMutationDelta) => void;
  replaceSnapshot: (snapshot: Pick<LifeOpsState, "logs" | "habits" | "workouts" | "career" | "healthMetrics">) => void;
};

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const found = items.some((item) => item.id === nextItem.id);
  return found ? items.map((item) => (item.id === nextItem.id ? nextItem : item)) : [nextItem, ...items];
}

function buildInitialLogs() {
  const today = getTodayString();
  return { [today]: getDailyLogMock(today) };
}

export const useLifeOpsStore = create<LifeOpsState>()(
  persist(
    (set) => ({
      logs: buildInitialLogs(),
      habits: [],
      workouts: [],
      career: [],
      healthMetrics: [],
      applyMutationDelta: (delta) =>
        set((state) => ({
          logs: delta.dailyLog ? { ...state.logs, [delta.dailyLog.date]: delta.dailyLog } : state.logs,
          habits: delta.habit ? upsertById(state.habits, delta.habit) : state.habits,
          workouts: delta.deletedWorkoutId
            ? state.workouts.filter((workout) => workout.id !== delta.deletedWorkoutId)
            : delta.workout
              ? [...upsertById(state.workouts, delta.workout)].sort((a, b) => b.date.localeCompare(a.date))
              : state.workouts,
          career: delta.deletedCareerId
            ? state.career.filter((career) => career.id !== delta.deletedCareerId)
            : delta.careerEntry
              ? [...upsertById(state.career, delta.careerEntry)].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
              : state.career,
          healthMetrics: delta.healthMetrics ?? state.healthMetrics,
        })),
      replaceSnapshot: (snapshot) =>
        set({
          logs: snapshot.logs,
          habits: snapshot.habits,
          workouts: snapshot.workouts,
          career: snapshot.career,
          healthMetrics: snapshot.healthMetrics,
        }),
    }),
    {
      name: "light-house-life-ops",
    },
  ),
);
