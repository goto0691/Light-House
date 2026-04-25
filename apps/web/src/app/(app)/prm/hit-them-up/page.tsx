import { HitThemUpClient } from "@/components/prm/hit-them-up-client";
import { GlassCard } from "@/components/shared/glass-card";
import { getPRMNeedsContact } from "@/lib/server/prm";

export default async function HitThemUpPage() {
  const people = await getPRMNeedsContact();

  return (
    <section className="space-y-4">
      <GlassCard className="p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">PRM</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Hit them up</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">연락 주기가 지난 사람들을 우선순위대로 모아, 바로 인물 360 화면으로 이어갑니다.</p>
      </GlassCard>
      <HitThemUpClient people={people} />
    </section>
  );
}
