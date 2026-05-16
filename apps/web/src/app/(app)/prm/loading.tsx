import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function PRMLoading() {
  return (
    <section aria-label="관계 화면을 불러오는 중" aria-live="polite" className="space-y-4" role="status">
      <p className="sr-only">관계 화면을 불러오는 중입니다.</p>
      <SkeletonBlock count={1} variant="card" />
      <SkeletonBlock count={1} variant="row" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          <SkeletonBlock count={6} variant="card" />
        </div>
        <SkeletonBlock count={1} variant="card" />
      </div>
    </section>
  );
}
