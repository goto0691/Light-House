"use client";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { MarkdownView } from "@/components/shared/markdown-view";
import { useVaultStore } from "@/stores/use-vault-store";

export function ZettelDrawer({ id }: { id: string }) {
  const zettel = useVaultStore((state) => state.zettels.find((item) => item.id === id));

  if (!zettel) {
    return <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">메모를 찾지 못했습니다.</div>;
  }

  return (
    <ContextBundlePanel
      density="drawer"
      enableAttach
      entityId={id}
      entityType="zettel"
      mainSlot={() => (
        <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">{zettel.type}</p>
        <h3 className="mt-2 text-2xl font-semibold text-foreground">{zettel.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{zettel.summary}</p>
      </section>
      <section className="rounded-lg border border-white/10 bg-white/5 p-6 md:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Content</p>
        <MarkdownView className="mt-5" value={zettel.content} />
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Outgoing</p>
        <div className="mt-3 space-y-2">
          {zettel.outgoingLinks.length ? (
            zettel.outgoingLinks.map((item) => (
              <p className="text-sm text-muted-foreground" key={item.id}>
                {item.title}
              </p>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">연결한 메모가 없습니다.</p>
          )}
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Backlinks</p>
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
