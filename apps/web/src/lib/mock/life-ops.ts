import type { SourceDocumentInfo } from "@/lib/mock/vault";

export type Habit = {
  id: string;
  title: string;
  icon: string;
  streak: number;
  completedToday: boolean;
};

export type HabitDefinition = {
  id: string;
  title: string;
  description: string;
  icon: string;
  schedule: string;
  isActive: boolean;
};

export type WorkoutLog = {
  id: string;
  date: string;
  categories: string;
  duration: number;
  intensity: number;
  notes: string;
};

export type CareerLog = {
  id: string;
  organization: string;
  role: string;
  period: string;
  category: string;
  description: string;
};

export type HealthMetric = {
  id: string;
  date: string;
  sleepHours: number;
  deepWorkMinutes: number;
  weight?: number;
  stepsCount?: number;
};

export type DailyLogMock = {
  date: string;
  mood: number;
  energy: number;
  emotions: string[];
  gratitude: string;
  journal: string;
  meditation: string;
  meditationVerse: string;
  habits: Habit[];
  sleepHours: number[];
  deepWorkMinutes: number;
  timeline: Array<{ time: string; label: string; type: string }>;
  sourceDocument?: SourceDocumentInfo | null;
};

export function getTodayString() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

export function getDailyLogMock(date: string): DailyLogMock {
  return {
    date,
    mood: 4,
    energy: 3,
    emotions: ["차분함", "집중", "감사"],
    gratitude: "재민과의 대화에서 겨울 메뉴 방향이 더 또렷해졌다.",
    journal: "오늘은 Project Light House의 P1을 닫고 Life Ops의 Daily Command Center로 넘어왔다.",
    meditation: "불안은 피해야 할 대상이 아니라 방향을 알려주는 신호일 수 있다.",
    meditationVerse: "시편 23:1",
    habits: [
      { id: "habit-1", title: "QT", icon: "🙏", streak: 9, completedToday: true },
      { id: "habit-2", title: "Deep Work", icon: "🧠", streak: 4, completedToday: true },
      { id: "habit-3", title: "Workout", icon: "🏃", streak: 2, completedToday: false },
      { id: "habit-4", title: "Water 2L", icon: "💧", streak: 6, completedToday: true },
    ],
    sleepHours: [6.2, 7.1, 6.8, 7.4, 5.9, 7.8, 6.9, 7.2, 6.7, 7.5, 6.4, 7.0, 6.8, 7.3],
    deepWorkMinutes: 165,
    timeline: [
      { time: "09:10", label: "Mood 4로 기록", type: "life" },
      { time: "11:30", label: "호떡집 겨울 메뉴 리서치 태스크 생성", type: "task" },
      { time: "14:00", label: "재민과 미팅 메모", type: "interaction" },
      { time: "19:40", label: "실존주의 관련 Zettel 수정", type: "zettel" },
    ],
  };
}

export function getHeatmapMock() {
  const today = new Date(`${getTodayString()}T00:00:00+09:00`);
  return Array.from({ length: 53 * 7 }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (53 * 7 - index));
    return {
      date: date.toISOString().slice(0, 10),
      value: index % 5,
    };
  });
}
