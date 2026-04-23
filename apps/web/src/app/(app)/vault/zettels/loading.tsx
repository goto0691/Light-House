import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function VaultZettelsLoading() {
  return (
    <section className="space-y-4">
      <SkeletonBlock count={1} variant="card" />
      <SkeletonBlock count={1} variant="row" />
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <SkeletonBlock count={3} variant="card" />
        <div className="space-y-4">
          <SkeletonBlock count={1} variant="card" />
          <SkeletonBlock count={1} variant="editor" />
        </div>
        <SkeletonBlock count={2} variant="card" />
      </div>
    </section>
  );
}
