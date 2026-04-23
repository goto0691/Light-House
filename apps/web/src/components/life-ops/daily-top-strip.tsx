import { EnergyButtonGroup } from "@/components/life-ops/energy-button-group";
import { MoodButtonGroup } from "@/components/life-ops/mood-button-group";
import { Tag } from "@/components/shared/tag";

type DailyTopStripProps = {
  date: string;
  mood: number;
  energy: number;
  emotions: string[];
  moodOptions: string[];
  energyOptions: string[];
  onMoodChange: (value: number) => void;
  onEnergyChange: (value: number) => void;
  disabled?: boolean;
};

export function DailyTopStrip({ date, mood, energy, emotions, moodOptions, energyOptions, onMoodChange, onEnergyChange, disabled }: DailyTopStripProps) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-[var(--shadow-md)]">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Life Ops · Daily Command Center</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">{date}</h1>
          <p className="mt-2 text-sm text-muted-foreground">하루의 상태, 습관, 저널링, 전 도메인 활동을 한 화면에서 정리합니다.</p>
        </div>
        <MoodButtonGroup disabled={disabled} onChange={onMoodChange} options={moodOptions} value={mood} />
      </div>
      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <EnergyButtonGroup disabled={disabled} onChange={onEnergyChange} options={energyOptions} value={energy} />
        <div className="flex flex-wrap gap-2">
          {emotions.map((emotion) => (
            <Tag className="normal-case tracking-normal" key={emotion} value={emotion} variant="custom" />
          ))}
        </div>
      </div>
    </div>
  );
}
