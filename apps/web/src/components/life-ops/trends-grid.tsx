"use client";

import { useEffect, useState } from "react";

import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
import { Sparkline } from "@/components/shared/sparkline";

type TrendsGridProps = {
  deferInitialData?: boolean;
  sleep: number[];
  deepWork: number[];
  heatmap: Array<{ date: string; value: number }>;
};

type TrendsPayload = {
  deepWork: number[];
  heatmap: Array<{ date: string; value: number }>;
  sleep: number[];
};

export function TrendsGrid({ deferInitialData = false, sleep, deepWork, heatmap }: TrendsGridProps) {
  const [data, setData] = useState<TrendsPayload>({ deepWork, heatmap, sleep });
  const [loading, setLoading] = useState(deferInitialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deferInitialData) {
      setData({ deepWork, heatmap, sleep });
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    async function loadTrends() {
      try {
        const response = await fetch("/api/life-ops/trends", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("흐름 데이터를 불러오지 못했습니다.");
        const payload = (await response.json()) as TrendsPayload;
        setData({
          deepWork: payload.deepWork ?? [],
          heatmap: payload.heatmap ?? [],
          sleep: payload.sleep ?? [],
        });
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setError(fetchError instanceof Error ? fetchError.message : "흐름 데이터를 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadTrends();

    return () => {
      controller.abort();
    };
  }, [deepWork, deferInitialData, heatmap, sleep]);

  if (loading) {
    return (
      <GlassCard className="p-5">
        <p className="text-sm text-muted-foreground">흐름 데이터를 불러오는 중입니다.</p>
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-5">
        <p className="text-sm text-muted-foreground">{error}</p>
      </GlassCard>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <GlassCard className="p-5">
        <p className="text-xs tracking-[0.08em] text-primary">흐름</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">기분, 수면, 에너지</h1>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-muted-foreground">수면 패턴</p>
            <Sparkline className="mt-4 h-20 w-full" data={data.sleep} />
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-muted-foreground">깊은 작업 흐름</p>
            <Sparkline className="mt-4 h-20 w-full" data={data.deepWork} />
          </div>
        </div>
      </GlassCard>
      <GlassCard className="p-5">
        <p className="text-xs tracking-[0.08em] text-primary">히트맵</p>
        <h2 className="mt-3 font-display text-4xl text-foreground">습관 활동</h2>
        <div className="mt-5">
          <Heatmap data={data.heatmap} />
        </div>
      </GlassCard>
    </div>
  );
}
