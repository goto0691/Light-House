import { GlassCard } from "@/components/shared/glass-card";
import { ShortcutsSettingsClient } from "@/components/settings/shortcuts-settings-client";
import { getShortcutSettingsOverview } from "@/lib/server/settings";

export default async function ShortcutsPage() {
  const overview = await getShortcutSettingsOverview();

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <p className="text-xs tracking-[0.08em] text-primary">단축키</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">단축키</h1>
        <p className="mt-3 text-sm text-muted-foreground">카테고리별 바인딩과 활성 상태를 한 곳에서 편집하도록 정리했습니다.</p>
      </GlassCard>
      <GlassCard className="p-5">
        <ShortcutsSettingsClient initial={overview} />
      </GlassCard>
    </section>
  );
}
