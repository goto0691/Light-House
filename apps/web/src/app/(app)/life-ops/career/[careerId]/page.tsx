import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getContextBundle } from "@/lib/server/context";
import { getLifeOpsCareerEntry, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function CareerDetailPage({
  params,
}: {
  params: Promise<{ careerId: string }>;
}) {
  const { careerId } = await params;
  await seedLifeOpsSupportData();
  const career = await getLifeOpsCareerEntry(careerId);
  if (!career) notFound();
  const bundle = await getContextBundle("career", careerId);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <GlassCard className="p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Career Detail</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">{career.organization}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{career.role}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Tag value={career.category} variant="custom" />
            <Tag value={career.period} variant="neutral" />
          </div>
          <p className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-muted-foreground">{career.description || "커리어 설명이 아직 없습니다."}</p>
        </GlassCard>
      }
      railDefaultLens="dates"
    />
  );
}
