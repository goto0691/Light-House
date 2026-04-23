import { notFound } from "next/navigation";

import { GlassCard } from "@/components/shared/glass-card";
import { ZettelDrawer } from "@/components/vault/zettel-drawer";
import { getVaultZettel, seedVaultSupportData } from "@/lib/server/vault";

export default async function ZettelDetailPage({
  params,
}: {
  params: Promise<{ zettelId: string }>;
}) {
  const { zettelId } = await params;
  await seedVaultSupportData();
  const zettel = await getVaultZettel(zettelId);
  if (!zettel) notFound();

  return (
    <section className="space-y-4">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Vault</p>
        <h1 className="mt-3 text-3xl font-semibold">{zettel.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Split View에서 보던 메모를 전체 화면으로 보는 딥링크입니다.</p>
      </GlassCard>
      <ZettelDrawer id={zettelId} />
    </section>
  );
}
