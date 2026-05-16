import { BentoCard } from "@/components/shared/bento-grid";
import { GlassCard } from "@/components/shared/glass-card";

type QuoteOfDayWidgetProps = {
  quote: string;
};

export function QuoteOfDayWidget({ quote }: QuoteOfDayWidgetProps) {
  return (
    <BentoCard colSpan={12} rowSpan={1}>
      <GlassCard className="h-full" elevation="l2">
        <p className="text-xs tracking-[0.08em] text-primary">오늘의 문장</p>
        <p className="mt-5 max-w-4xl font-display text-2xl leading-10 text-foreground md:text-[2rem] md:leading-[2.75rem]">{quote}</p>
      </GlassCard>
    </BentoCard>
  );
}
