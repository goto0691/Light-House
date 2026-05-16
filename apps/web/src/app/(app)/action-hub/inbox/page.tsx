import { GlassCard } from "@/components/shared/glass-card";
import { InboxClient } from "@/components/action-hub/inbox-client";

export default function ActionHubInboxPage() {
  return (
    <section className="space-y-4">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">작업실 · 수신함</p>
        <h1 className="mt-3 text-3xl font-semibold">라우팅 대기함</h1>
        <p className="mt-3 text-sm text-muted-foreground">빠른 캡처에서 들어온 미분류 작업과 검토 대기 캡처를 확인합니다.</p>
      </GlassCard>

      <InboxClient />
    </section>
  );
}
