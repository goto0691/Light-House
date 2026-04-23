import { GlassCard } from "@/components/shared/glass-card";

export default function IntegrationsPage() {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Integrations</p>
        <h1 className="mt-3 text-3xl font-semibold">Cloudflare / Notion</h1>
        <p className="mt-3 text-sm text-muted-foreground">D1, R2, Vectorize, Notion Import 상태를 확인하는 자리입니다. 아직 원격 연결은 일부러 뒤로 미뤄 둔 상태입니다.</p>
      </GlassCard>

      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Manual Runs</p>
        <h2 className="mt-3 text-3xl font-semibold">Cron 테스트</h2>
        <p className="mt-3 text-sm text-muted-foreground">Hit-Them-Up, 백업, 생일 알림, 주간 회고를 수동으로 실행하는 UI가 들어옵니다.</p>
      </GlassCard>
    </section>
  );
}
