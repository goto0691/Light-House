"use client";

import { BookOpenText, HeartHandshake, Sparkles } from "lucide-react";
import Link from "next/link";

export function OnboardingChecklist() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6 md:p-8">
      <p className="text-xs tracking-[0.08em] text-primary">시작하기</p>
      <h2 className="mt-4 font-display text-3xl text-foreground">Light House에 오신 걸 환영해요</h2>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        첫 지식, 첫 사람, 첫 습관만 열어도 대시보드가 훨씬 또렷해집니다.
      </p>
      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <Step href="/vault/zettels" icon={BookOpenText} text="첫 번째 지식 만들기" />
        <Step href="/prm" icon={HeartHandshake} text="기억하고 싶은 사람 한 명 추가" />
        <Step href="/life-ops/habits" icon={Sparkles} text="오늘 추적할 습관 하나 열기" />
      </div>
    </div>
  );
}

function Step({ href, icon: Icon, text }: { href: string; icon: typeof Sparkles; text: string }) {
  return (
    <Link className="rounded-md border border-white/10 bg-black/10 p-4 hover:border-primary/20 hover:bg-white/8" href={href}>
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-3 text-sm text-foreground">{text}</p>
    </Link>
  );
}
