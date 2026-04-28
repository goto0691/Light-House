import Link from "next/link";
import { Edit3, ExternalLink, Plus } from "lucide-react";

import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownView } from "@/components/shared/markdown-view";
import { Tag } from "@/components/shared/tag";
import type { ZettelMock } from "@/lib/mock/vault";

type ZettelReaderPaneProps = {
  zettel: ZettelMock;
  isPending?: boolean;
  onDelete?: () => void;
};

export function ZettelReaderPane({ zettel, isPending, onDelete }: ZettelReaderPaneProps) {
  return (
    <div className="space-y-4">
      <GlassCard priority="secondary">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">{zettel.type}</p>
            <h2 className="mt-3 text-balance font-display text-4xl leading-tight text-foreground">{zettel.title}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <Tag value={zettel.category} variant="custom" />
              {zettel.documentKind ? <Tag value={zettel.documentKind} variant="neutral" /> : null}
              {zettel.status ? <Tag value={zettel.status} variant="status" /> : null}
              <Tag value={`${zettel.outgoingLinks.length} outgoing`} variant="neutral" />
              <Tag value={`${zettel.backlinks.length} backlinks`} variant="neutral" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8" href="/vault/zettels/new">
              <Plus className="h-4 w-4" />
              새 메모
            </Link>
            <Link className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90" href={`/vault/zettels/${zettel.id}/edit`}>
              <Edit3 className="h-4 w-4" />
              편집
            </Link>
            {onDelete ? (
              <button
                className="focus-ring min-h-10 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                onClick={onDelete}
                type="button"
              >
                삭제
              </button>
            ) : null}
          </div>
        </div>
        {zettel.summary ? <p className="mt-5 max-w-3xl text-sm leading-7 text-muted-foreground">{zettel.summary}</p> : null}
        {zettel.source || zettel.sourceUrl || zettel.originalCreatedAt ? (
          <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {zettel.source ? <span className="rounded-md border border-white/10 bg-black/10 px-3 py-1.5">Source {zettel.source}</span> : null}
            {zettel.originalCreatedAt ? <span className="rounded-md border border-white/10 bg-black/10 px-3 py-1.5">{zettel.originalCreatedAt}</span> : null}
            {zettel.sourceUrl ? (
              <a className="focus-ring inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/10 px-3 py-1.5 text-primary" href={zettel.sourceUrl} rel="noreferrer" target="_blank">
                원문 <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        ) : null}
      </GlassCard>

      <GlassCard className="p-6 md:p-8" priority="secondary">
        <MarkdownView value={zettel.content || zettel.summary || "아직 본문이 없습니다."} />
      </GlassCard>
    </div>
  );
}
