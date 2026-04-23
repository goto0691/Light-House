import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { BentoCard } from "@/components/shared/bento-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { PersonMock } from "@/lib/mock/prm";

type HitThemUpWidgetProps = {
  people: PersonMock[];
};

export function HitThemUpWidget({ people }: HitThemUpWidgetProps) {
  return (
    <BentoCard colSpan={4} priority="primary" rowSpan={3}>
      <GlassCard className="h-full" interactive>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Hit Them Up</p>
        <p className="mt-2 text-sm text-muted-foreground">연락 리듬이 무너진 관계부터 위로 올립니다.</p>
        <div className="mt-5 space-y-3">
          {people.length ? (
            people.map((person, index) => (
              <Link
                className="block rounded-3xl border border-white/10 bg-white/5 p-4 transition hover:border-primary/20 hover:bg-white/8"
                href={`/prm?detail=person:${person.id}`}
                key={person.id}
                style={{ transform: `translateY(${index * -2}px)` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{person.name}</p>
                    <p className="mt-1 text-xs text-danger">+{person.daysSinceContact - person.cadenceDays} days overdue</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Tag size="sm" value={`layer_${person.layer}`} variant="dunbar" />
                  {person.groups.slice(0, 1).map((group) => (
                    <Tag key={group} size="sm" value={group} variant="neutral" />
                  ))}
                </div>
              </Link>
            ))
          ) : (
            <EmptyState description="모두에게 연락을 마쳤어요." icon="🎉" title="빈 카드 스택" />
          )}
        </div>
      </GlassCard>
    </BentoCard>
  );
}

