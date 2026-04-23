import { GlassCard } from "@/components/shared/glass-card";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export default function AppearancePage() {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Appearance</p>
        <h1 className="mt-3 text-3xl font-semibold">테마</h1>
        <div className="mt-6 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 p-5">
          <ThemeToggle />
          <p className="text-sm text-muted-foreground">Dark / Light 토글을 문서 기준으로 먼저 제공합니다.</p>
        </div>
      </GlassCard>

      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Dashboard Layout</p>
        <h2 className="mt-3 text-3xl font-semibold">Bento 레이아웃</h2>
        <p className="mt-3 text-sm text-muted-foreground">위젯 숨김, 순서 변경, 폰트 스케일 조정은 다음 단계에서 저장형 설정으로 연결합니다.</p>
      </GlassCard>
    </section>
  );
}
