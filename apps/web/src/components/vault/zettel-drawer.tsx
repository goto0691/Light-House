"use client";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { MarkdownView } from "@/components/shared/markdown-view";
import { getZettelOptionLabel, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
import { useVaultStore } from "@/stores/use-vault-store";

export function ZettelDrawer({ id }: { id: string }) {
  const zettel = useVaultStore((state) => state.zettels.find((item) => item.id === id));

  if (!zettel) {
    return <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">지식을 찾지 못했습니다.</div>;
  }

  const typeLabel = getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, zettel.type, zettel.type);

  return (
    <ContextBundlePanel
      density="drawer"
      enableAttach
      entityId={id}
      entityType="zettel"
      mainSlot={() => (
        <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">{typeLabel}</p>
        <h3 className="mt-2 text-2xl font-semibold text-foreground">{zettel.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{zettel.summary}</p>
      </section>
      <section className="rounded-lg border border-white/10 bg-white/5 p-6 md:p-8">
        <p className="text-xs tracking-[0.08em] text-primary">본문</p>
        <MarkdownView className="mt-5" value={zettel.content} />
      </section>
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">내가 연결한 지식</p>
        <div className="mt-3 space-y-2">
          {zettel.outgoingLinks.length ? (
            zettel.outgoingLinks.map((item) => (
              <p className="text-sm text-muted-foreground" key={item.id}>
                {item.title}
              </p>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">연결한 지식이 없습니다.</p>
          )}
        </div>
      </section>
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">나를 참조한 지식</p>
        <div className="mt-3 space-y-2">
          {zettel.backlinks.map((item) => (
            <p className="text-sm text-muted-foreground" key={item}>
              {item}
            </p>
          ))}
        </div>
      </section>
    </div>
      )}
      railDefaultLens="zettels"
    />
  );
}
