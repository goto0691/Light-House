"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { PRMGraphCanvas } from "@/components/prm/prm-graph-canvas";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { usePRMStore } from "@/stores/use-prm-store";

export function PRMGraphClient() {
  const [isPending, startTransition] = useTransition();
  const people = usePRMStore((state) => state.people);
  const networkEdges = usePRMStore((state) => state.networkEdges);
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);

  const [sourcePersonId, setSourcePersonId] = useState(people[0]?.id ?? "");
  const [targetPersonId, setTargetPersonId] = useState(people[1]?.id ?? people[0]?.id ?? "");
  const [relationType, setRelationType] = useState("");
  const [strength, setStrength] = useState(3);
  const [query, setQuery] = useState("");
  const hasDuplicateEdge = networkEdges.some(
    (edge) =>
      (edge.sourcePersonId === sourcePersonId && edge.targetPersonId === targetPersonId) ||
      (edge.sourcePersonId === targetPersonId && edge.targetPersonId === sourcePersonId),
  );
  const isInvalidEdge = !sourcePersonId || !targetPersonId || sourcePersonId === targetPersonId || hasDuplicateEdge;
  const visiblePeople = people.filter((person) => {
    if (query && !`${person.name} ${person.groups.join(" ")}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (targetPersonId && targetPersonId !== sourcePersonId) return;
    setTargetPersonId(people.find((person) => person.id !== sourcePersonId)?.id ?? "");
  }, [people, sourcePersonId, targetPersonId]);

  function submit() {
    if (isInvalidEdge) {
      toast.error(sourcePersonId === targetPersonId ? "같은 사람끼리는 연결할 수 없습니다." : "이미 존재하는 관계선입니다.");
      return;
    }
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          "/api/prm/network-edges",
          { sourcePersonId, targetPersonId, relationType, strength },
          replaceSnapshot,
        );
        setRelationType("");
        setStrength(3);
        toast.success("관계선을 추가했습니다.");
      } catch (error) {
        toast.error("관계선 추가에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function removeEdge(edgeId: string) {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/prm/network-edges/${edgeId}/delete`,
          undefined,
          replaceSnapshot,
        );
        toast.success("관계선을 제거했습니다.");
      } catch (error) {
        toast.error("관계선 제거에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">관계 그래프</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">관계선 관리</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">사람 간 연결을 빠르게 만들고 지우면서, 레이어와 그룹을 함께 훑을 수 있는 그래프 진입점입니다.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/10 px-4 py-2 text-xs tracking-[0.08em] text-muted-foreground">{networkEdges.length}개 관계선</span>
        </div>
      </GlassCard>

      <FilterBar filters={[]} onChange={(state) => setQuery(state.q)} searchPlaceholder="이름, 그룹 기준으로 노드 찾기" />

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="glass rounded-[20px] p-5">
        <p className="text-xs tracking-[0.08em] text-primary">관계 그래프</p>
        <h1 className="mt-3 font-display text-3xl text-foreground">관계선 추가</h1>
        <div className="mt-5 space-y-3">
          <select className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setSourcePersonId(event.target.value)} value={sourcePersonId}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                출발: {person.name}
              </option>
            ))}
          </select>
          <select className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setTargetPersonId(event.target.value)} value={targetPersonId}>
            {people.filter((person) => person.id !== sourcePersonId).map((person) => (
              <option key={person.id} value={person.id}>
                도착: {person.name}
              </option>
            ))}
          </select>
          {hasDuplicateEdge ? <p className="text-xs text-destructive">이미 같은 두 사람 사이의 관계선이 있습니다.</p> : null}
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setRelationType(event.target.value)} placeholder="예: 교회, 업무, 창작" value={relationType} />
          <input className="w-full" max={5} min={1} onChange={(event) => setStrength(Number(event.target.value))} type="range" value={strength} />
          <p className="text-xs text-muted-foreground">강도 {strength}/5</p>
          <button className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={isPending || isInvalidEdge} onClick={submit} type="button">
            {isPending ? "저장 중..." : "관계선 추가"}
          </button>
        </div>
        </div>

        <PRMGraphCanvas edges={networkEdges} onDeleteEdge={removeEdge} people={visiblePeople} />
      </section>
    </section>
  );
}
