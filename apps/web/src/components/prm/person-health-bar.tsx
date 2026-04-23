type PersonHealthBarProps = {
  lastContactDays: number;
  cadenceDays: number;
};

export function PersonHealthBar({ lastContactDays, cadenceDays }: PersonHealthBarProps) {
  const overdue = lastContactDays > cadenceDays;
  const progress = Math.min(100, Math.round((lastContactDays / cadenceDays) * 100));

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Relationship Health</span>
        <span>
          {lastContactDays}d / cadence {cadenceDays}d
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-white/8">
        <div className={overdue ? "h-2 rounded-full bg-[hsl(var(--danger))]" : "h-2 rounded-full bg-[hsl(var(--primary))]"} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
