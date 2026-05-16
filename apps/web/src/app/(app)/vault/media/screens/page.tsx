import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getVaultMediaList } from "@/lib/server/vault";

export default async function ScreensPage() {
  const screens = await getVaultMediaList("screen");

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <p className="text-xs tracking-[0.08em] text-primary">지식금고 미디어</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">영상 서가</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">영화와 영상 감상 기록을 관련 지식, 사람, 속성 정보와 함께 탐색합니다.</p>
      </GlassCard>

      {screens.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {screens.map((item) => (
            <Link className="rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/8" href={`/vault/media/${item.id}`} key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl text-foreground">{item.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{item.creator}</p>
                </div>
                <Tag value={item.status} variant="status" />
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{item.review}</p>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState description="통합 미디어 갤러리에서 영상 로그를 추가하면 이곳에 모입니다." illustration="generic" title="영상 기록이 없습니다" />
      )}
    </section>
  );
}
