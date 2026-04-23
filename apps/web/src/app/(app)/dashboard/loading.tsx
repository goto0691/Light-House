import { BentoCard, BentoGrid } from "@/components/shared/bento-grid";
import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function DashboardLoading() {
  return (
    <BentoGrid>
      <BentoCard colSpan={12}>
        <SkeletonBlock count={1} variant="card" />
      </BentoCard>
      <BentoCard colSpan={8}>
        <SkeletonBlock count={1} variant="card" />
      </BentoCard>
      <BentoCard colSpan={4}>
        <SkeletonBlock count={1} variant="card" />
      </BentoCard>
      <BentoCard colSpan={8}>
        <SkeletonBlock count={1} variant="heatmap" />
      </BentoCard>
      <BentoCard colSpan={4}>
        <SkeletonBlock count={1} variant="sparkline" />
      </BentoCard>
      <BentoCard colSpan={6}>
        <SkeletonBlock count={3} variant="row" />
      </BentoCard>
      <BentoCard colSpan={6}>
        <SkeletonBlock count={3} variant="row" />
      </BentoCard>
      <BentoCard colSpan={12}>
        <SkeletonBlock count={1} variant="card" />
      </BentoCard>
    </BentoGrid>
  );
}
