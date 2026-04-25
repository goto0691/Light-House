import { PRMGraphClient } from "@/components/prm/prm-graph-client";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { GlassCard } from "@/components/shared/glass-card";
import { getContextBundle } from "@/lib/server/context";
import { getPRMSnapshot } from "@/lib/server/prm";

export default async function PRMGraphPage() {
  const snapshot = await getPRMSnapshot();
  const bundles = await Promise.all(
    snapshot.people.slice(0, 8).map((person) => getContextBundle("person", person.id, { depth: 2, include: ["explicit", "source", "inferred"], limit: 10 })),
  );

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">ContextBundle Network</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">사람 관계 맥락맵</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">PRM 그래프의 직접 network edge와 Person 360에서 쓰는 ContextBundle 관계를 같은 화면에서 대조합니다.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {bundles.map((bundle) => (
            <ContextMapMini bundle={bundle} key={bundle.focus.id} />
          ))}
        </div>
      </GlassCard>
      <PRMGraphClient />
    </section>
  );
}
