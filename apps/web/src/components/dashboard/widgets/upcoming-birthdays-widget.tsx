import { Gift, PartyPopper } from "lucide-react";
import Link from "next/link";

import { BentoCard } from "@/components/shared/bento-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import type { PersonMock } from "@/lib/mock/prm";

type UpcomingBirthdaysWidgetProps = {
  people: PersonMock[];
};

export function UpcomingBirthdaysWidget({ people }: UpcomingBirthdaysWidgetProps) {
  return (
    <BentoCard colSpan={6} rowSpan={2}>
      <GlassCard className="h-full" interactive>
        <p className="text-xs tracking-[0.08em] text-primary">다가오는 생일</p>
        <div className="mt-5 space-y-3">
          {people.length ? (
            people.map((person) => (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3" key={person.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <PartyPopper className="h-4 w-4 text-primary" />
                    <p className="truncate text-sm font-medium text-foreground">{person.name}</p>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">{person.upcomingBirthday}</p>
                </div>
                <Link className="inline-flex items-center gap-2 rounded-md border border-primary/18 bg-primary/10 px-3 py-1.5 text-xs tracking-[0.08em] text-primary" href="/prm/gifts">
                  <Gift className="h-3.5 w-3.5" />
                  <span>선물 제안</span>
                </Link>
              </div>
            ))
          ) : (
            <EmptyState description="다가오는 생일이 없습니다." icon="🎂" title="조용한 달력" />
          )}
        </div>
      </GlassCard>
    </BentoCard>
  );
}
