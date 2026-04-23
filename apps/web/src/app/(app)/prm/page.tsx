import Link from "next/link";

import { PRMClient } from "@/components/prm/prm-client";
import { GlassCard } from "@/components/shared/glass-card";

export default function PrmPage() {
  return (
    <section className="space-y-6">
      <GlassCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-primary">PRM</p>
            <h1 className="mt-3 text-3xl font-semibold">관계 관리 허브</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              기획서 기준 P3의 핵심인 인물 카드, 연락 주기 시각화, Drawer 진입, 선물/그래프 이동을 먼저 열었습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href="/prm?filter=needs-contact">
              Hit Them Up
            </Link>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href="/prm/gifts">
              Gifts
            </Link>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href="/prm/graph">
              Graph
            </Link>
          </div>
        </div>
      </GlassCard>

      <PRMClient />
    </section>
  );
}
