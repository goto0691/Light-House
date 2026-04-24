import { EnergyButtonGroup } from "@/components/life-ops/energy-button-group";
import { MoodButtonGroup } from "@/components/life-ops/mood-button-group";
import { PageHeader } from "@/components/shared/page-layout";
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
    <PageHeader
      eyebrow="Life Ops"
      title={date}
      description="하루의 상태, 습관, 저널링, 전 도메인 활동을 한 화면에서 정리합니다."
      meta={
        emotions.map((emotion) => (
          <Tag className="normal-case tracking-normal" key={emotion} value={emotion} variant="custom" />
        ))
      }
      actions={
        <div className="grid gap-3">
          <MoodButtonGroup disabled={disabled} onChange={onMoodChange} options={moodOptions} value={mood} />
        <EnergyButtonGroup disabled={disabled} onChange={onEnergyChange} options={energyOptions} value={energy} />
        </div>
      }
    />
  );
}
