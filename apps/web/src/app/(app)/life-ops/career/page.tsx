import { GlassCard } from "@/components/shared/glass-card";
import { getLifeOpsCareer, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function CareerPage() {
  await seedLifeOpsSupportData();
  const career = await getLifeOpsCareer();
  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Career</p>
      <h1 className="mt-3 text-3xl font-semibold">커리어 타임라인</h1>
      <div className="mt-6 space-y-4">
        {career.map((item) => (
          <div className="flex gap-4" key={`${item.organization}-${item.period}`}>
            <div className="mt-1 h-3 w-3 rounded-full bg-primary" />
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">{item.period}</p>
              <h2 className="mt-1 text-lg font-medium text-foreground">{item.organization}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{item.role}</p>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
