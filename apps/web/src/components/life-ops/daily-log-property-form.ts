import type { DailyLogMock } from "@/lib/mock/life-ops";

export type DailyLogPropertyForm = {
  date: string;
  mood: string;
  energy: string;
  emotions: string[];
  sleepHours: string;
  deepWorkMinutes: string;
  gratitude: string;
  journal: string;
  meditation: string;
  meditationVerse: string;
};

export function buildDailyLogPropertyForm(log: DailyLogMock): DailyLogPropertyForm {
  return {
    date: log.date,
    mood: String(log.mood),
    energy: String(log.energy),
    emotions: log.emotions,
    sleepHours: String(log.sleepHours[log.sleepHours.length - 1] ?? 0),
    deepWorkMinutes: String(log.deepWorkMinutes),
    gratitude: log.gratitude,
    journal: log.journal,
    meditation: log.meditation,
    meditationVerse: log.meditationVerse,
  };
}

export function dailyLogPropertyPayload(form: DailyLogPropertyForm) {
  return {
    mood: numberFromForm(form.mood, 3),
    energy: numberFromForm(form.energy, 3),
    emotions: form.emotions,
    sleepHours: numberFromForm(form.sleepHours, 0),
    deepWorkMinutes: numberFromForm(form.deepWorkMinutes, 0),
    gratitude: form.gratitude,
    journal: form.journal,
    meditation: form.meditation,
    meditationVerse: form.meditationVerse,
  };
}

function numberFromForm(value: string, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}
