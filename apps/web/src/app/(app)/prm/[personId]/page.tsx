import { notFound } from "next/navigation";

import { Person360Client } from "@/components/prm/person-360-client";
import { compactContextBundleForPage } from "@/lib/context/compact-bundle";
import { getContextBundle } from "@/lib/server/context";
import { getPRMPerson } from "@/lib/server/prm";

export default async function PersonDeepLinkPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const [person, bundle] = await Promise.all([getPRMPerson(personId), getContextBundle("person", personId)]);

  if (!person) notFound();

  return <Person360Client bundle={compactContextBundleForPage(bundle, { edgeLimit: 36, nodePreviewLength: 80, snippetLength: 80 })} />;
}
