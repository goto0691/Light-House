import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function VaultZettelsLoading() {
  return (
    <section aria-label="지식 목록을 불러오는 중" aria-live="polite" className="space-y-4" role="status">
      <p className="sr-only">지식 목록을 불러오는 중입니다.</p>
      <SkeletonBlock count={1} variant="card" />
      <SkeletonBlock count={1} variant="row" />
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        <SkeletonBlock count={6} variant="card" />
      </div>
    </section>
  );
}
