import { notFound, redirect } from "next/navigation";

import { getVaultZettel } from "@/lib/server/vault";

export default async function EditZettelPage({
  params,
}: {
  params: Promise<{ zettelId: string }>;
}) {
  const { zettelId } = await params;
  const zettel = await getVaultZettel(zettelId);
  if (!zettel) notFound();

  redirect(`/vault/zettels/${zettelId}`);
}
