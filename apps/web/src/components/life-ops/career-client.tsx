"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CareerNode } from "@/components/life-ops/career-node";
import { FilterBar } from "@/components/shared/filter-bar";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

export function CareerClient() {
  const [isPending, startTransition] = useTransition();
  const career = useLifeOpsStore((state) => state.career);
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");

  const filteredCareer = career.filter((item) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return [item.organization, item.role, item.description, item.category].some((value) => value?.toLowerCase().includes(keyword));
  });

  return (
    <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="glass rounded-[20px] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Career</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">커리어 타임라인</h1>
        <div className="mt-4 space-y-3">
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setOrganization(event.target.value)} placeholder="조직명" value={organization} />
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setRole(event.target.value)} placeholder="역할" value={role} />
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
          <button
            className="rounded-2xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                    "/api/life-ops/career",
                    { organization, role, startDate, category: "work" },
                    replaceSnapshot,
                  );
                  setOrganization("");
                  setRole("");
                  toast.success("커리어 이력을 추가했습니다.");
                } catch (error) {
                  toast.error("커리어 추가에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            이력 추가
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <FilterBar
          filters={[
            {
              kind: "select",
              key: "category",
              label: "Category",
              options: [
                { value: "work", label: "Work" },
                { value: "study", label: "Study" },
                { value: "service", label: "Service" },
              ],
            },
          ]}
          onChange={(state) => {
            setQuery(state.q);
          }}
          searchPlaceholder="조직, 역할, 설명 검색"
        />
        {filteredCareer.map((item) => (
          <CareerNode
            item={item}
            key={item.id}
            onDelete={() => {
              startTransition(async () => {
                try {
                  await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                    `/api/life-ops/career/${item.id}/delete`,
                    undefined,
                    replaceSnapshot,
                  );
                } catch (error) {
                  toast.error("커리어 삭제에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
          />
        ))}
      </div>
    </section>
  );
}
