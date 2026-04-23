import { SkeletonBlock } from "@/components/shared/skeleton-block";

export default function ActionHubProjectLoading() {
  return (
    <section className="space-y-4">
      <SkeletonBlock className="max-w-4xl" count={1} variant="card" />
      <SkeletonBlock count={1} variant="row" />
      <div className="grid gap-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="glass rounded-[28px] p-4" key={index}>
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
