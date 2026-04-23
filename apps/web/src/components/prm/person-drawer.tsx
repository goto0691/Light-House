"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { postSnapshotMutation } from "@/lib/snapshot-client";
import { usePRMStore } from "@/stores/use-prm-store";

export function PersonDrawer({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const person = usePRMStore((state) => state.people.find((item) => item.id === id));
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);

  if (!person) {
    return (
      <section className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
        인물 데이터를 찾지 못했습니다.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Person</p>
        <h3 className="mt-2 text-2xl font-semibold text-foreground">{person.name}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{person.bio}</p>
        <div className="mt-4 flex gap-2">
          <button
            className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                    `/api/prm/people/${id}/contact`,
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
          <button
            className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                    `/api/prm/people/${id}/favorite`,
                    undefined,
                    replaceSnapshot,
                  );
                  toast.success("즐겨찾기 상태를 저장했습니다.");
                } catch (error) {
                  toast.error("즐겨찾기 저장에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            즐겨찾기 토글
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {person.groups.map((group) => (
            <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-foreground" key={group}>
              {group}
            </span>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Gifts" value={String(person.giftsCount)} />
        <MetricCard label="Interactions" value={String(person.interactionsCount)} />
        <MetricCard label="Tasks" value={String(person.tasksCount)} />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Basic Info</p>
        <p className="mt-3 text-sm text-foreground">Core Value</p>
        <p className="mt-1 text-sm text-muted-foreground">{person.coreValue}</p>
        <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
          <p>Last contacted {person.daysSinceContact} days ago</p>
          <p>Cadence every {person.cadenceDays} days</p>
          <p>Status: {person.status}</p>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Timeline</p>
        <div className="mt-4 space-y-3">
          {person.timeline.map((item) => (
            <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3" key={`${item.date}-${item.title}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{item.kind}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.date}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
