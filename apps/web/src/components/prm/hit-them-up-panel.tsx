"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { type PRMMutationDelta, usePRMStore } from "@/stores/use-prm-store";
import type { PersonMock } from "@/lib/mock/prm";

type HitThemUpPanelProps = {
  onMutationDelta?: (delta: PRMMutationDelta) => void;
  people: PersonMock[];
};

export function HitThemUpPanel({ onMutationDelta, people }: HitThemUpPanelProps) {
  const [isPending, startTransition] = useTransition();
  const applyMutationDelta = usePRMStore((state) => state.applyMutationDelta);

  function applyContactDelta(delta: PRMMutationDelta) {
    applyMutationDelta(delta);
    onMutationDelta?.(delta);
  }

  return (
    <GlassCard className="h-fit p-5">
      <p className="text-xs tracking-[0.08em] text-primary">연락 필요</p>
      <h2 className="mt-3 font-display text-3xl text-foreground">연락 시급 인물</h2>
      <div className="mt-4 space-y-3">
        {people.map((person) => (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4" key={person.id}>
            <Link className="block" href={`/prm?detail=person:${person.id}`} scroll={false}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{person.name}</p>
                <span className="text-xs text-danger">{person.daysSinceContact - person.cadenceDays}일 초과</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{person.groups.join(" · ")}</p>
            </Link>
            <button
              className="mt-3 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                      `/api/prm/people/${person.id}/contact`,
                      undefined,
                      applyContactDelta,
                    );
                    toast.success(`${person.name} 연락 완료로 마킹했습니다.`);
                  } catch (error) {
                    toast.error("연락 완료 저장에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              연락했음
            </button>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
