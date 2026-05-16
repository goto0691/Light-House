import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <GlassCard className="max-w-xl text-center" priority="hero">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">404</p>
        <p className="mt-4 text-sm uppercase tracking-[0.18em] text-muted-foreground">Light House</p>
        <h1 className="text-balance mt-4 font-display text-5xl text-foreground">길을 잃으셨나요?</h1>
        <p className="text-pretty mt-3 text-sm leading-6 text-muted-foreground">찾으시는 페이지를 아직 만들지 않았거나, 등대의 경로가 조금 바뀌었습니다. 오늘 보기에서 다시 방향을 잡아드릴게요.</p>
        <Link className="focus-ring mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-glow)]" href="/dashboard">
          오늘 보기로 돌아가기
        </Link>
      </GlassCard>
    </main>
  );
}
