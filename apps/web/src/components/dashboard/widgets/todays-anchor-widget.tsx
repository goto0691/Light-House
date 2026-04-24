import { Compass, MoonStar, SunMedium } from "lucide-react";
import Link from "next/link";

import { BentoCard } from "@/components/shared/bento-grid";
import { GlassCard } from "@/components/shared/glass-card";

type TodaysAnchorWidgetProps = {
  date: string;
  dailyLog: { mood?: number | null; energy?: number | null; journal?: string | null } | null;
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return { label: "심야", icon: MoonStar };
  if (hour < 12) return { label: "아침", icon: SunMedium };
  if (hour < 18) return { label: "오후", icon: SunMedium };
  return { label: "저녁", icon: MoonStar };
}

export function TodaysAnchorWidget({ date, dailyLog }: TodaysAnchorWidgetProps) {
  const greeting = getGreeting();
  const GreetingIcon = greeting.icon;

  return (
    <BentoCard colSpan={12} priority="hero" rowSpan={1}>
      <GlassCard className="h-full overflow-hidden" elevation="l2" variant="elevated">
        <div className="relative">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_45%)]" />
          <p className="relative text-xs uppercase tracking-[0.28em] text-primary">Light House</p>
          <div className="relative mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <GreetingIcon className="h-4 w-4 text-primary" />
            <span>{date}</span>
            <span>·</span>
            <span>{greeting.label} 브리핑</span>
          </div>
          <h2 className="relative mt-4 font-display text-3xl leading-[1.12] text-foreground">
            오늘의 방향을
            <br />
            차분하게 고정합니다.
          </h2>
          <p className="relative mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            {dailyLog?.journal || "아직 오늘의 의도가 비어 있습니다. Life Ops에서 오늘의 감정과 에너지를 먼저 잡아보세요."}
          </p>
          <div className="relative mt-6 flex flex-wrap gap-2">
            <Pill label={`Mood ${dailyLog?.mood ?? "-"}`} />
            <Pill label={`Energy ${dailyLog?.energy ?? "-"}`} />
            <Link className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-primary" href="/life-ops">
              <Compass className="h-3.5 w-3.5" />
              <span>Open Life Ops</span>
            </Link>
          </div>
        </div>
      </GlassCard>
    </BentoCard>
  );
}

function Pill({ label }: { label: string }) {
  return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</span>;
}
