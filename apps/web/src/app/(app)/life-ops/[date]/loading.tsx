import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function DailyLogLoading() {
  return (
    <section className="space-y-6">
      <SkeletonBlock count={1} variant="card" />
      <div className="grid gap-4 xl:grid-cols-2">
        <SkeletonBlock count={1} variant="card" />
        <SkeletonBlock count={1} variant="card" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SkeletonBlock count={1} variant="editor" />
        <SkeletonBlock count={2} variant="card" />
      </div>
      <SkeletonBlock count={1} variant="heatmap" />
      <SkeletonBlock count={4} variant="row" />
    </section>
  );
}
