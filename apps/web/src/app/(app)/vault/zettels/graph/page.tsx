import { GlassCard } from "@/components/shared/glass-card";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { getZettelOptionLabel, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
import { getContextBundle } from "@/lib/server/context";
import { getVaultZettelGraph } from "@/lib/server/vault";

export default async function ZettelGraphPage() {
  const graphNodes = await getVaultZettelGraph();
  const contextCandidates = graphNodes
    .filter((zettel) => zettel.outgoingCount + zettel.backlinkCount > 0)
    .slice(0, 6);
  const bundles = await Promise.all(
    contextCandidates.map((zettel) => getContextBundle("zettel", zettel.id, { depth: 1, include: ["explicit", "source"], limit: 6 })),
  );

  return (
    <section className="space-y-4">
      <GlassCard>
        <p className="text-xs tracking-[0.08em] text-primary">지식 그래프</p>
        <h1 className="mt-3 text-3xl font-semibold">지식 그래프</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">전용 링크 그래프와 ContextBundle 관계 규칙을 함께 확인합니다.</p>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <GlassCard>
          <p className="text-xs tracking-[0.08em] text-primary">맥락 지도</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">문서별 맥락 미니맵</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {bundles.length ? (
              bundles.map((bundle) => (
                <ContextMapMini bundle={bundle} key={bundle.focus.id} />
              ))
            ) : (
              <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">직접 연결된 지식이 생기면 미니맵이 표시됩니다.</p>
            )}
          </div>
        </GlassCard>

        <GlassCard>
          <p className="text-xs tracking-[0.08em] text-primary">연결 색인</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">직접 링크 상태</h2>
          <div className="mt-5 grid gap-3">
            {graphNodes.map((zettel) => (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4" key={zettel.id}>
                <p className="text-sm font-medium text-foreground">{zettel.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{zettel.category}</p>
                <p className="mt-3 text-xs tracking-[0.08em] text-primary">{getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, zettel.type, zettel.type)}</p>
                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  <p>나가는 연결 {zettel.outgoingCount}</p>
                  <p>들어오는 연결 {zettel.backlinkCount}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </section>
  );
}
