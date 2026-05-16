import { GlassCard } from "@/components/shared/glass-card";
import { Sparkline } from "@/components/shared/sparkline";

type DailyDataColumnProps = {
  sleepHours: number[];
  deepWorkMinutes: number;
};

export function DailyDataColumn({ sleepHours, deepWorkMinutes }: DailyDataColumnProps) {
  return (
    <GlassCard className="p-5">
      <p className="text-xs tracking-[0.08em] text-muted-foreground">일일 데이터</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-muted-foreground">수면 시간</p>
          <Sparkline className="mt-4 h-20 w-full" data={sleepHours} />
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-muted-foreground">딥워크</p>
          <p className="mt-6 font-display text-5xl text-foreground">{deepWorkMinutes}</p>
          <p className="mt-2 text-sm text-muted-foreground">오늘 기록한 분</p>
        </div>
      </div>
    </GlassCard>
  );
}
