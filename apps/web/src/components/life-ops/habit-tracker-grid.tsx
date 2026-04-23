import type { Habit } from "@/lib/mock/life-ops";

import { HabitCard } from "@/components/life-ops/habit-card";

type HabitTrackerGridProps = {
  habits: Habit[];
  onToggle: (habitId: string) => void;
  disabled?: boolean;
};

export function HabitTrackerGrid({ habits, onToggle, disabled }: HabitTrackerGridProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {habits.map((habit) => (
        <HabitCard disabled={disabled} habit={habit} key={habit.id} onToggle={() => onToggle(habit.id)} />
      ))}
    </div>
  );
}
