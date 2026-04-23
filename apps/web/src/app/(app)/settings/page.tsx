import { getSession } from "@/lib/auth/session";
import { getSettingsHomeOverview } from "@/lib/server/settings";

import { GlassCard } from "@/components/shared/glass-card";
import { LogoutForm } from "@/components/shared/logout-form";
import { ProfileSettingsClient } from "@/components/settings/profile-settings-client";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import Link from "next/link";

export default async function SettingsPage() {
  const session = await getSession();
  const overview = await getSettingsHomeOverview();

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <GlassCard className="min-h-[320px]">
        <p className="text-xs uppercase tracking-[0.28em] text-primary">Settings</p>
        <h1 className="mt-3 text-3xl font-semibold">계정</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          P0에서는 단일 관리자 계정과 세션 보호 흐름을 먼저 연결했습니다.
        </p>

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

      <GlassCard className="min-h-[320px]">
        <p className="text-xs uppercase tracking-[0.28em] text-primary">Appearance</p>
        <h2 className="mt-3 text-3xl font-semibold">테마</h2>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          디자인 시스템 문서에 맞춰 Dark 기본값과 Light 대응을 함께 준비했습니다.
        </p>
        <div className="mt-8 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 p-5">
          <ThemeToggle />
          <p className="text-sm text-muted-foreground">다크와 라이트 모드를 즉시 전환할 수 있습니다.</p>
        </div>
      </GlassCard>

      <GlassCard className="min-h-[320px]">
        <p className="text-xs uppercase tracking-[0.28em] text-primary">Pages</p>
        <h2 className="mt-3 text-3xl font-semibold">세부 설정</h2>
        <div className="mt-5 grid gap-3">
          {[
            ["/settings/appearance", "Appearance"],
            ["/settings/data", "Data"],
            ["/settings/integrations", "Integrations"],
            ["/settings/shortcuts", "Shortcuts"],
            ["/settings/ai", "AI"],
          ].map(([href, label]) => (
            <Link className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground transition hover:bg-white/8" href={href} key={href}>
              {label}
            </Link>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
