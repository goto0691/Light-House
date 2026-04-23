"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { PersonCard } from "@/components/prm/person-card";
import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { usePRMStore } from "@/stores/use-prm-store";

export function PRMClient() {
  const [isPending, startTransition] = useTransition();
  const people = usePRMStore((state) => state.people);
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);
  const needsContact = people
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div className="mb-4 flex flex-wrap gap-2">
          {["All", "Hit Them Up", "Favorites", "Layer 5", "Layer 15", "Layer 50", "Layer 150"].map((filter) => (
            <button className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/8 hover:text-foreground" key={filter} type="button">
              {filter}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {people.map((person) => (
            <PersonCard key={person.id} person={person} />
          ))}
        </div>
      </div>

      <GlassCard className="h-fit">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Hit Them Up</p>
        <h2 className="mt-3 text-2xl font-semibold">연락 시급 인물</h2>
        <div className="mt-4 space-y-3">
          {needsContact.map((person) => (
            <div className="block rounded-3xl border border-white/10 bg-white/5 p-4" key={person.id}>
              <Link className="block" href={`/prm?detail=person:${person.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{person.name}</p>
                  <span className="text-xs text-danger">+{person.daysSinceContact - person.cadenceDays}d overdue</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{person.groups.join(" · ")}</p>
              </Link>
              <button
                className="mt-3 rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/prm/people/${person.id}/contact`,
                        undefined,
                        replaceSnapshot,
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
    </div>
  );
}
