import { GlassCard } from "@/components/shared/glass-card";
import { getLifeOpsSnapshot, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function DiariesPage() {
  await seedLifeOpsSupportData();
  const snapshot = await getLifeOpsSnapshot();
  const items = Object.values(snapshot.logs)
    .filter((log) => log.journal.trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Diaries</p>
      <h1 className="mt-3 text-3xl font-semibold">일기 아카이브</h1>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={item.date}>
            <p className="text-xs uppercase tracking-[0.2em] text-primary">{item.date}</p>
            <p className="mt-2 text-sm text-muted-foreground">{item.journal}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
