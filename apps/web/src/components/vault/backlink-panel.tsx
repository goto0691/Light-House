import { Network } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { GlassCard } from "@/components/shared/glass-card";
import { SourceDocumentPanel } from "@/components/shared/source-document-panel";
import type { SearchItem } from "@/lib/mock/search";
import type { ZettelMock } from "@/lib/mock/vault";

type BacklinkPanelProps = {
  zettel: ZettelMock;
  semanticResults: SearchItem[];
  onSelectSemantic: (id: string) => void;
  onRemoveLink: (linkId: string) => void;
  isPending?: boolean;
};

export function BacklinkPanel({ zettel, semanticResults, onSelectSemantic, onRemoveLink, isPending }: BacklinkPanelProps) {
  return (
    <GlassCard className="p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Backlinks & Context</p>

      <div className="mt-5">
        <SourceDocumentPanel sourceDocument={zettel.sourceDocument} />
      </div>

      <div className="mt-5">
        <p className="text-sm font-medium text-foreground">이 메모가 연결하는 항목</p>
        <div className="mt-3 space-y-2">
          {zettel.outgoingLinks.length ? (
            zettel.outgoingLinks.map((item) => (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3" key={item.id}>
                <p className="text-sm text-muted-foreground">{item.title}</p>
                <button
                  className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
                  disabled={isPending}
                  onClick={() => onRemoveLink(item.id)}
                  type="button"
                >
                  해제
                </button>
              </div>
            ))
          ) : (
            <EmptyState className="min-h-[160px]" description="이 메모에서 이어진 링크가 아직 없습니다." icon={Network} title="연결 대기 중" />
          )}
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-foreground">이 메모를 참조하는 항목</p>
        <div className="mt-3 space-y-2">
          {zettel.backlinks.length ? (
            zettel.backlinks.map((item) => (
              <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-muted-foreground" key={item}>
                {item}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">아직 참조 링크가 없습니다.</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-foreground">의미적으로 가까운 메모</p>
        <div className="mt-3 space-y-2">
          {semanticResults.length ? (
            semanticResults.map((item) => (
              <button
                className="block w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:bg-white/8"
                key={item.id}
                onClick={() => onSelectSemantic(item.id)}
                type="button"
              >
                <p className="text-sm text-foreground">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.snippet}</p>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">의미 검색 결과가 아직 없습니다.</p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
