import { GlassCard } from "@/components/shared/glass-card";
import type { Habit } from "@/lib/mock/life-ops";
import { cn } from "@/lib/utils/cn";

type HabitCardProps = {
  habit: Habit;
  onToggle: () => void;
  disabled?: boolean;
};

export function HabitCard({ habit, onToggle, disabled }: HabitCardProps) {
  return (
    <GlassCard
      as="button"
      className={cn(
        "w-full border p-4 text-left",
        habit.completedToday ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5 hover:bg-white/8",
        disabled && "opacity-60",
      )}
      disabled={disabled}
      interactive
      onClick={onToggle}
      priority="secondary"
    >
      <div className="flex items-center justify-between">
        <span className="text-2xl">{habit.icon}</span>
        <span className="tabular-nums text-xs text-muted-foreground">{habit.streak} day streak</span>
      </div>
      <h2 className="text-balance mt-3 font-display text-2xl text-foreground">{habit.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{habit.completedToday ? "오늘 완료" : "오늘 아직 미기록"}</p>
      <div className="mt-4 rounded-full bg-black/10 p-1">
        <div className={cn("h-1.5 rounded-full transition-all duration-300", habit.completedToday ? "w-full bg-primary" : "w-1/3 bg-white/15")} />
      </div>
    </GlassCard>
  );
}
