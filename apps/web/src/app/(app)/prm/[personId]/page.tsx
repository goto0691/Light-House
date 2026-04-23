import { notFound } from "next/navigation";

import { GlassCard } from "@/components/shared/glass-card";
import { PersonDrawer } from "@/components/prm/person-drawer";
import { getPRMPerson, seedPRMSupportData } from "@/lib/server/prm";

export default async function PersonDeepLinkPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  await seedPRMSupportData();
  const person = await getPRMPerson(personId);

  if (!person) notFound();

  return (
    <section className="space-y-4">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">PRM</p>
        <h1 className="mt-3 text-3xl font-semibold">{person.name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Drawer와 동일한 내용을 전체 페이지로 보는 딥링크 화면입니다.</p>
      </GlassCard>
      <PersonDrawer id={personId} />
    </section>
  );
}
