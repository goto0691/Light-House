import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function PRMLoading() {
  return (
    <section className="space-y-4">
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
