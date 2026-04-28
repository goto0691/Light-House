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
  const zettel = await getVaultZettel(zettelId);
  if (!zettel) notFound();
  const savedViews = await listSavedViews({ domain: "library", scope: "knowledge" });

  return <ZettelsClient savedViews={savedViews} selectedZettelId={zettelId} />;
}
