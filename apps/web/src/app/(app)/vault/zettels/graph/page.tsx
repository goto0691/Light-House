import { GlassCard } from "@/components/shared/glass-card";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { getContextBundle } from "@/lib/server/context";
import { getVaultSnapshot } from "@/lib/server/vault";

export default async function ZettelGraphPage() {
  const snapshot = await getVaultSnapshot();
  const bundles = await Promise.all(
    snapshot.zettels.slice(0, 9).map((zettel) => getContextBundle("zettel", zettel.id, { depth: 2, include: ["explicit", "source", "mention", "semantic"], limit: 10 })),
  );

  return (
    <section className="space-y-4">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Zettel Graph</p>
        <h1 className="mt-3 text-3xl font-semibold">지식 그래프</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">전용 링크 그래프와 ContextBundle 관계 규칙을 함께 확인합니다.</p>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <GlassCard>
          <p className="text-xs uppercase tracking-[0.24em] text-primary">ContextBundle Maps</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">문서별 맥락 미니맵</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {bundles.map((bundle) => (
              <ContextMapMini bundle={bundle} key={bundle.focus.id} />
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Link Index</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">직접 링크 상태</h2>
          <div className="mt-5 grid gap-3">
            {snapshot.zettels.map((zettel) => (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4" key={zettel.id}>
                <p className="text-sm font-medium text-foreground">{zettel.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{zettel.category}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.2em] text-primary">{zettel.type}</p>
                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  <p>Outgoing {zettel.outgoingLinks.length}</p>
                  <p>Backlinks {zettel.backlinks.length}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </section>
  );
}
