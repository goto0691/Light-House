import { getSession } from "@/lib/auth/session";
import { getSettingsHomeOverview } from "@/lib/server/settings";

import { GlassCard } from "@/components/shared/glass-card";
import { LogoutForm } from "@/components/shared/logout-form";
import { ProfileSettingsClient } from "@/components/settings/profile-settings-client";

export default async function ProfileSettingsPage() {
  const session = await getSession();
  const overview = await getSettingsHomeOverview();

  return (
    <GlassCard className="min-h-[420px]">
      <p className="text-xs uppercase tracking-[0.28em] text-primary">Settings</p>
      <h1 className="mt-3 text-3xl font-semibold">프로필</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">계정 표시 이름, 로케일, 타임존을 확인하고 세션을 관리합니다.</p>
      <ProfileSettingsClient
        profile={{
          displayName: overview.profile.displayName ?? session?.displayName ?? "Light Keeper",
          email: overview.profile.email ?? session?.email ?? "keeper@lighthouse.local",
          locale: overview.profile.locale,
          timezone: overview.profile.timezone,
          theme: overview.profile.theme,
        }}
      />
      <div className="mt-3">
        <LogoutForm />
      </div>
    </GlassCard>
  );
}
