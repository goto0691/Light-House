import { BookText } from "lucide-react";
import Link from "next/link";

import { BentoCard } from "@/components/shared/bento-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getZettelOptionLabel, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
import type { ZettelMock } from "@/lib/mock/vault";

type RecentZettelsWidgetProps = {
  zettels: ZettelMock[];
};

export function RecentZettelsWidget({ zettels }: RecentZettelsWidgetProps) {
  return (
    <BentoCard colSpan={6} rowSpan={2}>
      <GlassCard className="h-full">
        <p className="text-xs uppercase tracking-[0.16em] text-primary">최근 지식</p>
        <div className="mt-5 space-y-3">
          {zettels.length ? (
            zettels.map((zettel) => {
              const typeLabel = getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, zettel.type, zettel.type);
              return (
                <Link
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:border-primary/20 hover:bg-white/8"
                  href={`/vault/zettels/${zettel.id}`}
                  key={zettel.id}
                >
                  <div className="rounded-md border border-white/10 bg-black/20 p-2 text-primary">
                    <BookText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{zettel.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Tag size="sm" value={typeLabel} variant="neutral" />
                      <Tag size="sm" value={zettel.category} variant="custom" />
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <EmptyState
              cta={{ label: "새 지식", href: "/vault/zettels?new=1", hotkey: "Cmd+N" }}
              description="생각은 쓰는 순간 연결됩니다."
              icon="지식"
              title="첫 번째 지식을 남겨보세요"
            />
          )}
        </div>
      </GlassCard>
    </BentoCard>
  );
}
