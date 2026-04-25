import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getPRMNeedsContact, seedPRMSupportData } from "@/lib/server/prm";

export default async function HitThemUpPage() {
  await seedPRMSupportData();
  const people = await getPRMNeedsContact();

  return (
    <section className="space-y-4">
      <GlassCard className="p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">PRM</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Hit them up</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">연락 주기가 지난 사람들을 우선순위대로 모아, 바로 인물 360 화면으로 이어갑니다.</p>
      </GlassCard>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {people.map((person) => (
          <Link className="rounded-lg border border-white/10 bg-white/5 p-5 transition hover:bg-white/8" href={`/prm/${person.id}`} key={person.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-foreground">{person.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{person.groups.join(" · ")}</p>
              </div>
              <Tag value={`${person.daysSinceContact}d`} variant="status" />
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{person.bio}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Tag value={`cadence ${person.cadenceDays}d`} variant="neutral" />
              <Tag value={`layer ${person.layer}`} variant="dunbar" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
