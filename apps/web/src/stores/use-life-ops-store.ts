"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getDailyLogMock, getTodayString, type CareerLog, type DailyLogMock, type HabitDefinition, type HealthMetric, type WorkoutLog } from "@/lib/mock/life-ops";

type LifeOpsState = {
  logs: Record<string, DailyLogMock>;
  habits: HabitDefinition[];
  workouts: WorkoutLog[];
  career: CareerLog[];
  healthMetrics: HealthMetric[];
  replaceSnapshot: (snapshot: Pick<LifeOpsState, "logs" | "habits" | "workouts" | "career" | "healthMetrics">) => void;
};

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
