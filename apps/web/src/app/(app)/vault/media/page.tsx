import { GlassCard } from "@/components/shared/glass-card";
import { MediaClient } from "@/components/vault/media-client";

export default function MediaPage() {
  return (
    <section className="space-y-4">
      <GlassCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Media Logs</p>
            <h1 className="mt-3 text-3xl font-semibold">통합 미디어 갤러리</h1>
          </div>
          <div className="flex gap-2">
            {["All", "Games", "Books", "Screens"].map((tab) => (
              <button className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" key={tab} type="button">
                {tab}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>
      <MediaClient />
    </section>
  );
}
