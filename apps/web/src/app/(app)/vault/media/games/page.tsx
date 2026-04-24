import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export default async function GamesPage() {
  await seedVaultSupportData();
  const snapshot = await getVaultSnapshot();
  const games = snapshot.media.filter((item) => item.mediaType === "game");

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Vault Media</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">게임 서가</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">게임 로그만 분리해 상태, 감상, 연결된 사람과 메모로 이어지는 목록입니다.</p>
      </GlassCard>

      {games.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {games.map((item) => (
            <Link className="rounded-lg border border-white/10 bg-white/5 p-4 transition hover:bg-white/8" href={`/vault/media/${item.id}`} key={item.id}>
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
        <EmptyState description="통합 미디어 갤러리에서 게임 로그를 추가하면 이곳에 모입니다." illustration="generic" title="게임 기록이 없습니다" />
      )}
    </section>
  );
}
