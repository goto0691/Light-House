"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getDailyLogMock, getTodayString, type DailyLogMock } from "@/lib/mock/life-ops";

type LifeOpsState = {
  logs: Record<string, DailyLogMock>;
  replaceSnapshot: (snapshot: Pick<LifeOpsState, "logs">) => void;
  ensureLog: (date: string) => void;
  setMood: (date: string, mood: number) => void;
  setEnergy: (date: string, energy: number) => void;
  toggleHabit: (date: string, habitId: string) => void;
  updateJournalField: (date: string, field: "journal" | "meditation" | "gratitude", value: string) => void;
};

function buildInitialLogs() {
  const today = getTodayString();
  return {
    [today]: getDailyLogMock(today),
  };
}

export const useLifeOpsStore = create<LifeOpsState>()(
  persist(
    (set, get) => ({
      logs: buildInitialLogs(),
      replaceSnapshot: (snapshot) => set({ logs: snapshot.logs }),
      ensureLog: (date) =>
        set((state) => ({
          logs: state.logs[date]
            ? state.logs
            : {
                ...state.logs,
                [date]: getDailyLogMock(date),
              },
        })),
      setMood: (date, mood) => {
        get().ensureLog(date);
        set((state) => ({
          logs: {
            ...state.logs,
            [date]: { ...state.logs[date], mood },
          },
        }));
      },
      setEnergy: (date, energy) => {
        get().ensureLog(date);
        set((state) => ({
          logs: {
            ...state.logs,
            [date]: { ...state.logs[date], energy },
          },
        }));
      },
      toggleHabit: (date, habitId) => {
        get().ensureLog(date);
        set((state) => ({
          logs: {
            ...state.logs,
            [date]: {
              ...state.logs[date],
              habits: state.logs[date].habits.map((habit) =>
                habit.id === habitId
                  ? {
                      ...habit,
                      completedToday: !habit.completedToday,
                      streak: habit.completedToday ? Math.max(0, habit.streak - 1) : habit.streak + 1,
                    }
                  : habit,
              ),
            },
          },
        }));
      },
      updateJournalField: (date, field, value) => {
        get().ensureLog(date);
        set((state) => ({
          logs: {
            ...state.logs,
            [date]: {
              ...state.logs[date],
              [field]: value,
            },
          },
        }));
      },
    }),
    {
      name: "light-house-life-ops",
    },
  ),
);
