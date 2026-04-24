import { notFound } from "next/navigation";

import { Person360Client } from "@/components/prm/person-360-client";
import { getPRMPerson, seedPRMSupportData } from "@/lib/server/prm";
import { getContextBundle } from "@/lib/server/context";

export default async function PersonDeepLinkPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  await seedPRMSupportData();
  const [person, bundle] = await Promise.all([getPRMPerson(personId), getContextBundle("person", personId)]);

  if (!person) notFound();

  return <Person360Client bundle={bundle} />;
}
