import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function ActionHubProjectLoading() {
  return (
    <section aria-label="프로젝트 작업실을 불러오는 중" aria-live="polite" className="space-y-4" role="status">
      <p className="sr-only">프로젝트 작업실을 불러오는 중입니다.</p>
      <SkeletonBlock className="max-w-4xl" count={1} variant="card" />
      <SkeletonBlock count={1} variant="row" />
      <div className="grid gap-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="glass rounded-lg p-4" key={index}>
            <SkeletonBlock count={1} variant="text" />
            <div className="mt-4">
              <SkeletonBlock count={3} variant="row" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
