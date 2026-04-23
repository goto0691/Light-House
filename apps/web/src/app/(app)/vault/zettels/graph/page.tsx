import { GlassCard } from "@/components/shared/glass-card";
import { ZETTELS_MOCK } from "@/lib/mock/vault";

export default function ZettelGraphPage() {
  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Zettel Graph</p>
      <h1 className="mt-3 text-3xl font-semibold">지식 그래프</h1>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ZETTELS_MOCK.map((zettel) => (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={zettel.id}>
            <p className="text-sm font-medium text-foreground">{zettel.title}</p>
            <p className="mt-2 text-sm text-muted-foreground">{zettel.category}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-primary">{zettel.type}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
