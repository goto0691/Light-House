import { BrainCircuit } from "lucide-react";

import { BentoCard } from "@/components/shared/bento-grid";
import { GlassCard } from "@/components/shared/glass-card";
import { Sparkline } from "@/components/shared/sparkline";

type BrainEnergyGaugeProps = {
  energyScore: number;
  last7Days: number[];
};

export function BrainEnergyGauge({ energyScore, last7Days }: BrainEnergyGaugeProps) {
  const ring = Math.max(0, Math.min(100, energyScore * 20));
  const stroke = 2 * Math.PI * 42;
  const dashOffset = stroke - (stroke * ring) / 100;
  const tone =
    energyScore >= 4
      ? "hsl(var(--color-domain-energy-hyperfocus))"
      : energyScore <= 2
        ? "hsl(var(--color-domain-energy-routine))"
        : "hsl(var(--color-domain-energy-normal))";

  return (
    <BentoCard colSpan={4} rowSpan={2}>
      <GlassCard className="h-full" interactive>
        <p className="text-xs tracking-[0.08em] text-primary">집중 에너지</p>
        <div className="mt-5 flex items-center gap-5">
          <div className="relative h-28 w-28 shrink-0">
            <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" fill="none" r="42" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
              <circle
                cx="50"
                cy="50"
                fill="none"
                r="42"
                stroke={tone}
                strokeDasharray={stroke}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                strokeWidth="7"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <span className="mt-2 text-2xl font-semibold text-foreground">{energyScore}</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-6 text-muted-foreground">오늘의 에너지와 최근 7일 리듬을 함께 보여줍니다.</p>
            <Sparkline className="mt-4 h-16 w-full" color={tone} data={last7Days} height={64} />
          </div>
        </div>
      </GlassCard>
    </BentoCard>
  );
}
