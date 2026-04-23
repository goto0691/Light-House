import { GlassCard } from "@/components/shared/glass-card";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";

export default async function PRMGraphPage() {
  await seedPRMSupportData();
  const snapshot = await getPRMSnapshot();
  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">PRM Graph</p>
      <h1 className="mt-3 text-3xl font-semibold">관계망 그래프</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        P3의 관계 그래프 진입점입니다. 현재는 그룹과 계층을 먼저 확인할 수 있도록 노드 요약만 배치했습니다.
      </p>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {snapshot.people.map((person) => (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={person.id}>
            <p className="text-sm font-medium text-foreground">{person.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{person.groups.join(" · ")}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-primary">Layer {person.layer}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
