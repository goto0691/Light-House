import { GlassCard } from "@/components/shared/glass-card";

type TimelineItem = { time: string; label: string; type: string };

export function DailyAutoJoinFeed({ items }: { items: TimelineItem[] }) {
  return (
    <GlassCard className="p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">오늘의 연결</p>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div className="flex items-start gap-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-3" key={`${item.time}-${item.label}`}>
            <div className="rounded-full bg-primary/15 px-3 py-1 text-xs text-primary">{item.time}</div>
            <div>
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.24em] text-muted-foreground">{item.type}</p>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
