import { GlassCard } from "@/components/shared/glass-card";
import { AppearanceSettingsClient } from "@/components/settings/appearance-settings-client";
import { getAppearanceSettingsOverview } from "@/lib/server/settings";

export default async function AppearancePage() {
  const overview = await getAppearanceSettingsOverview();

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Appearance</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">외형 및 레이아웃</h1>
        <p className="mt-3 text-sm text-muted-foreground">AppearanceControls, GlassOpacityControl, BentoLayoutEditor 구조를 페이지 안에서 분리해 실제 편집 흐름에 더 가깝게 맞췄습니다.</p>
      </GlassCard>
      <GlassCard className="p-5">
        <AppearanceSettingsClient initial={overview} />
      </GlassCard>
    </section>
  );
}
