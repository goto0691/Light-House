import { GlassCard } from "@/components/shared/glass-card";

export default function AISettingsPage() {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">AI</p>
        <h1 className="mt-3 text-3xl font-semibold">라우팅 설정</h1>
        <p className="mt-3 text-sm text-muted-foreground">Quick Capture confidence 임계값, fallback 모델, 사용량 집계가 들어올 자리입니다.</p>
      </GlassCard>
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Usage</p>
        <h2 className="mt-3 text-3xl font-semibold">월간 사용량</h2>
        <p className="mt-3 text-sm text-muted-foreground">`ai_conversations` 집계를 기반으로 추후 실제 사용량 그래프를 연결합니다.</p>
      </GlassCard>
    </section>
  );
}
