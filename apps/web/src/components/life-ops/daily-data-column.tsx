import { GlassCard } from "@/components/shared/glass-card";
import { Sparkline } from "@/components/shared/sparkline";

type DailyDataColumnProps = {
  sleepHours: number[];
  deepWorkMinutes: number;
  sleepDraft: number;
  deepWorkDraft: number;
  onSleepDraftChange: (value: number) => void;
  onDeepWorkDraftChange: (value: number) => void;
  onSave: () => void;
  disabled?: boolean;
};

export function DailyDataColumn({ sleepHours, deepWorkMinutes, sleepDraft, deepWorkDraft, onSleepDraftChange, onDeepWorkDraftChange, onSave, disabled }: DailyDataColumnProps) {
  return (
    <GlassCard className="p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Daily Data Column</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-muted-foreground">Sleep Hours</p>
          <Sparkline className="mt-4 h-20 w-full" data={sleepHours} />
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-muted-foreground">Deep Work</p>
          <p className="mt-6 font-display text-5xl text-foreground">{deepWorkMinutes}</p>
          <p className="mt-2 text-sm text-muted-foreground">minutes today</p>
        </div>
      </div>
      <div className="mt-4 rounded-3xl border border-white/10 bg-black/10 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Health Update</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => onSleepDraftChange(Number(event.target.value))} step="0.1" type="number" value={sleepDraft} />
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => onDeepWorkDraftChange(Number(event.target.value))} type="number" value={deepWorkDraft} />
        </div>
        <button className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground" disabled={disabled} onClick={onSave} type="button">
          Health 저장
        </button>
      </div>
    </GlassCard>
  );
}
