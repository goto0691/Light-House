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
        <p className="text-xs tracking-[0.08em] text-primary">설정</p>
        <h1 className="mt-3 text-3xl font-semibold">계정</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          계정 정보와 세션 상태를 확인하고, 작업 공간의 기본 표시 방식을 관리합니다.
        </p>

        <ProfileSettingsClient
          profile={{
            displayName: overview.profile.displayName ?? session?.displayName ?? "관리자",
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
        <p className="text-xs tracking-[0.08em] text-primary">화면</p>
        <h2 className="mt-3 text-3xl font-semibold">테마</h2>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          디자인 시스템 문서에 맞춰 Dark 기본값과 Light 대응을 함께 준비했습니다.
        </p>
        <div className="mt-8 flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-5">
          <ThemeToggle />
          <p className="text-sm text-muted-foreground">다크와 라이트 모드를 즉시 전환할 수 있습니다.</p>
        </div>
      </GlassCard>

      <GlassCard className="min-h-[320px]">
        <p className="text-xs tracking-[0.08em] text-primary">설정 페이지</p>
        <h2 className="mt-3 text-3xl font-semibold">세부 설정</h2>
        <div className="mt-5 grid gap-3">
          {[
            ["/settings/appearance", "화면"],
            ["/settings/profile", "프로필"],
            ["/settings/data", "데이터"],
            ["/settings/integrations", "연동"],
            ["/settings/shortcuts", "단축키"],
            ["/settings/ai", "AI"],
          ].map(([href, label]) => (
            <Link className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground hover:bg-white/8" href={href} key={href}>
              {label}
            </Link>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
