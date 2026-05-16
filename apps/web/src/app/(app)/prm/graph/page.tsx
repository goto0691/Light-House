import { PRMGraphClient } from "@/components/prm/prm-graph-client";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { GlassCard } from "@/components/shared/glass-card";
import { compactContextBundleForMini } from "@/lib/context/compact-bundle";
import { getContextBundle } from "@/lib/server/context";
import { getPRMContextPeople, getPRMHydrationSnapshot } from "@/lib/server/prm";

export default async function PRMGraphPage() {
  const [people, initialSnapshot] = await Promise.all([getPRMContextPeople(4), getPRMHydrationSnapshot("/prm/graph")]);
  const bundles = await Promise.all(
    people.map((person) => getContextBundle("person", person.id, { depth: 1, include: ["explicit", "source"], limit: 6 })),
  );
  const compactBundles = bundles.map((bundle) => compactContextBundleForMini(bundle));

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">맥락 관계망</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">사람 관계 맥락맵</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">관계 그래프의 직접 관계선과 사람 360에서 쓰는 맥락 관계를 같은 화면에서 대조합니다.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {compactBundles.map((bundle) => (
            <ContextMapMini bundle={bundle} key={bundle.focus.id} />
          ))}
        </div>
      </GlassCard>
      <PRMGraphClient initialSnapshot={initialSnapshot} />
    </section>
  );
}
