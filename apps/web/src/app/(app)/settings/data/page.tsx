import { GlassCard } from "@/components/shared/glass-card";

export default function DataSettingsPage() {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Data Import</p>
        <h1 className="mt-3 text-3xl font-semibold">노션 가져오기</h1>
        <p className="mt-3 text-sm text-muted-foreground">Notion Export zip 업로드와 매핑 UI를 위한 자리입니다. 현재는 로컬 스캐폴드만 준비했습니다.</p>
      </GlassCard>

      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Export & Backup</p>
        <h2 className="mt-3 text-3xl font-semibold">내보내기</h2>
        <p className="mt-3 text-sm text-muted-foreground">JSON / Markdown ZIP 내보내기와 백업 목록 UI가 여기로 들어옵니다.</p>
      </GlassCard>
    </section>
  );
}
