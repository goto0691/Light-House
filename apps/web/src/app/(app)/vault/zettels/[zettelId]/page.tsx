import { notFound } from "next/navigation";

import { ZettelsClient } from "@/components/vault/zettels-client";
import { listSavedViews } from "@/lib/server/ui-state";
import { getVaultZettel } from "@/lib/server/vault";

export default async function ZettelDetailPage({
  params,
}: {
  params: Promise<{ zettelId: string }>;
}) {
  const { zettelId } = await params;
  const [zettel, savedViews] = await Promise.all([
    getVaultZettel(zettelId),
    listSavedViews({ domain: "library", scope: "knowledge" }),
  ]);
  if (!zettel) notFound();

  return <ZettelsClient deferInitialZettels initialSelectedZettel={zettel} initialZettels={[]} savedViews={savedViews} selectedZettelId={zettelId} />;
}
