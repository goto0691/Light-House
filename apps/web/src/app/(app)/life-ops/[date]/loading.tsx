import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function DailyLogLoading() {
  return (
    <section aria-label="일일 기록을 불러오는 중" aria-live="polite" className="space-y-6" role="status">
      <p className="sr-only">일일 기록을 불러오는 중입니다.</p>
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
