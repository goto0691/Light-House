import Link from "next/link";

import type { PersonMock } from "@/lib/mock/prm";

export function PersonCard({ person }: { person: PersonMock }) {
  const overdue = person.daysSinceContact > person.cadenceDays;
  const progress = Math.min(100, Math.round((person.daysSinceContact / person.cadenceDays) * 100));

  return (
    <Link
      className={`glass block rounded-[24px] p-5 transition hover:translate-y-[-2px] ${overdue ? "shadow-[0_0_28px_rgba(239,68,68,0.15)]" : ""}`}
      href={`/prm?detail=person:${person.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{person.name}</h2>
            {person.nickname ? <span className="text-sm text-muted-foreground">({person.nickname})</span> : null}
            {person.favorite ? <span className="rounded-full bg-primary/15 px-2 py-1 text-[11px] text-primary">STAR</span> : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{person.bio}</p>
        </div>
        <div
          className="h-3 w-3 rounded-full"
          style={{
            backgroundColor:
              person.layer === 5
                ? "hsl(var(--danger))"
                : person.layer === 15
                  ? "hsl(var(--warning))"
                  : person.layer === 50
                    ? "hsl(var(--info))"
                    : "hsl(var(--muted-foreground))",
          }}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {person.groups.map((group) => (
          <span className="rounded-full bg-white/6 px-3 py-1 text-xs text-foreground" key={group}>
            {group}
          </span>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Relationship Health</span>
          <span>
            {person.daysSinceContact}d / cadence {person.cadenceDays}d
          </span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-white/8">
          <div
            className={`h-2 rounded-full ${overdue ? "bg-[hsl(var(--danger))]" : "bg-[hsl(var(--primary))]"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
        <span>Layer {person.layer}</span>
        {person.upcomingBirthday ? <span>🎂 {person.upcomingBirthday}</span> : <span>{person.status}</span>}
      </div>
    </Link>
  );
}
