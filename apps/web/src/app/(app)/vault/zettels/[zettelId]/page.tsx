import { notFound } from "next/navigation";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownView } from "@/components/shared/markdown-view";
import { Tag } from "@/components/shared/tag";
import { getVaultZettel } from "@/lib/server/vault";

export default async function ZettelDetailPage({
  params,
}: {
  params: Promise<{ zettelId: string }>;
}) {
  const { zettelId } = await params;
  const zettel = await getVaultZettel(zettelId);
  if (!zettel) notFound();

  return (
    <ContextBundlePanel
      density="page"
      enableAttach
      entityId={zettelId}
      entityType="zettel"
      mainSlot={() => (
        <section className="space-y-4">
          <GlassCard className="p-6 md:p-8">
            <p className="text-xs uppercase tracking-[0.24em] text-primary">{zettel.type}</p>
            <h1 className="mt-3 font-display text-5xl text-foreground">{zettel.title}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <Tag value={zettel.category} variant="custom" />
              <Tag value={`${zettel.outgoingLinks.length} links`} variant="neutral" />
            </div>
            <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">{zettel.summary}</p>
          </GlassCard>
          <GlassCard className="p-6 md:p-10">
            <MarkdownView value={zettel.content} />
          </GlassCard>
        </section>
      )}
      railDefaultLens="zettels"
    />
  );
}
