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
        <span>관계 건강도</span>
        <span>
          {lastContactDays}일 / 주기 {cadenceDays}일
        </span>
      </div>
      <div className="mt-2 h-2 rounded-md bg-white/8">
        <div className={overdue ? "h-2 rounded-sm bg-[hsl(var(--danger))]" : "h-2 rounded-sm bg-[hsl(var(--primary))]"} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
