"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

type ProfileSettingsClientProps = {
  profile: {
    displayName: string;
    email: string;
    locale: string;
    timezone: string;
    theme: string;
  };
};

export function ProfileSettingsClient({ profile }: ProfileSettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [locale, setLocale] = useState(profile.locale);
  const [timezone, setTimezone] = useState(profile.timezone);

  return (
    <div className="mt-8 space-y-3 rounded-lg border border-white/10 bg-white/5 p-5">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2 text-sm text-muted-foreground">
          <span>표시 이름</span>
          <input
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground outline-none"
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        </label>
        <label className="space-y-2 text-sm text-muted-foreground">
          <span>이메일</span>
          <input className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm text-muted-foreground" disabled value={profile.email} />
        </label>
        <label className="space-y-2 text-sm text-muted-foreground">
          <span>로케일</span>
          <input className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground outline-none" onChange={(event) => setLocale(event.target.value)} value={locale} />
        </label>
        <label className="space-y-2 text-sm text-muted-foreground">
          <span>타임존</span>
          <input className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground outline-none" onChange={(event) => setTimezone(event.target.value)} value={timezone} />
        </label>
      </div>

      <div className="flex items-center justify-between rounded-md border border-white/10 bg-black/10 px-4 py-3 text-sm text-muted-foreground">
        <span>테마 기본값</span>
        <strong className="text-foreground">{profile.theme}</strong>
      </div>

      <button
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            try {
              const response = await fetch("/api/settings/profile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName, locale, timezone }),
              });

              const payload = (await response.json()) as { error?: string };
              if (!response.ok) {
                throw new Error(payload.error ?? "프로필 저장에 실패했습니다.");
              }

              toast.success("프로필 설정을 저장했습니다.");
            } catch (error) {
              toast.error("프로필 저장에 실패했습니다.", {
                description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
              });
            }
          });
        }}
        type="button"
      >
        프로필 저장
      </button>
    </div>
  );
}
