import { GlassCard } from "@/components/shared/glass-card";

type TimelineItem = { time: string; label: string; type: string };

const TIMELINE_TYPE_LABELS: Record<string, string> = {
  interaction: "상호작용",
  life: "생활",
  task: "작업",
  zettel: "지식",
};

export function DailyAutoJoinFeed({ items }: { items: TimelineItem[] }) {
  return (
    <GlassCard className="p-5">
      <p className="text-xs tracking-[0.08em] text-muted-foreground">오늘의 연결</p>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div className="flex items-start gap-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3" key={`${item.time}-${item.label}`}>
          <div className="rounded-md bg-primary/15 px-3 py-1 text-xs text-primary">{item.time}</div>
            <div>
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{TIMELINE_TYPE_LABELS[item.type] ?? item.type}</p>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
