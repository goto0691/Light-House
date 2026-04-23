import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { PersonHealthBar } from "@/components/prm/person-health-bar";
import { Tag } from "@/components/shared/tag";
import type { PersonMock } from "@/lib/mock/prm";
import { getLayerColor } from "@/lib/mock/prm";

export function PersonCard({ person }: { person: PersonMock }) {
  const overdue = person.daysSinceContact > person.cadenceDays;

  return (
    <GlassCard
      as={Link}
      className={overdue ? "shadow-[0_0_28px_rgba(239,68,68,0.15)]" : ""}
      href={`/prm?detail=person:${person.id}`}
      interactive
      priority="primary"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div
              aria-hidden="true"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-primary-foreground"
              style={{ backgroundColor: getLayerColor(person.layer) }}
            >
              {person.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <h2 className="text-balance truncate font-display text-2xl text-foreground">{person.name}</h2>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">Layer {person.layer}</p>
            </div>
            {person.nickname ? <span className="text-sm text-muted-foreground">({person.nickname})</span> : null}
            {person.favorite ? <Tag value="favorite" variant="custom" /> : null}
          </div>
          <p className="text-pretty mt-3 text-sm text-muted-foreground">{person.bio}</p>
        </div>
        <Tag value={person.status} variant="status" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {person.groups.map((group) => (
          <Tag className="normal-case tracking-normal" key={group} value={group} variant="custom" />
        ))}
        <Tag value={`${person.layer}`} variant="dunbar" />
      </div>

      <PersonHealthBar cadenceDays={person.cadenceDays} lastContactDays={person.daysSinceContact} />

      <div className="tabular-nums mt-5 flex items-center justify-between text-xs text-muted-foreground">
        <span>{person.interactionsCount} interactions</span>
        {person.upcomingBirthday ? <span>🎂 {person.upcomingBirthday}</span> : <span>{person.daysSinceContact}d since contact</span>}
      </div>
    </GlassCard>
  );
}
