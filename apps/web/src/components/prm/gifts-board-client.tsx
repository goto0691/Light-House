"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { GiftBoard } from "@/components/prm/gift-board";
import { GiftCard } from "@/components/prm/gift-card";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { usePRMStore } from "@/stores/use-prm-store";

export function GiftsBoardClient() {
  const [isPending, startTransition] = useTransition();
  const gifts = usePRMStore((state) => state.gifts);
  const people = usePRMStore((state) => state.people);
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState<"given" | "received">("given");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [satisfaction, setSatisfaction] = useState("");
  const [query, setQuery] = useState("");

  const peopleMap = new Map(people.map((person) => [person.id, person.name]));
  const filteredGifts = gifts.filter((gift) => {
    if (query && !`${gift.title} ${peopleMap.get(gift.personId) ?? ""} ${gift.satisfaction ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  function submit() {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/prm/people/${personId}/gifts`,
          { title, direction, occurredAt, satisfaction },
          replaceSnapshot,
        );
        setTitle("");
        setSatisfaction("");
        toast.success("선물을 기록했습니다.");
      } catch (error) {
        toast.error("선물 기록에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function removeGift(giftId: string) {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/prm/gifts/${giftId}/delete`,
          undefined,
          replaceSnapshot,
        );
        toast.success("선물을 목록에서 제거했습니다.");
      } catch (error) {
        toast.error("선물 삭제에 실패했습니다.", {
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
            <p className="text-xs uppercase tracking-[0.24em] text-primary">PRM Gifts</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">선물 보드</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">준 선물과 받은 선물을 한 화면에서 보고, 인물별 선물 기록을 바로 남길 수 있도록 구성했습니다.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{filteredGifts.length} gifts</span>
        </div>
      </GlassCard>

      <FilterBar filters={[]} onChange={(state) => setQuery(state.q)} searchPlaceholder="선물 이름, 인물, 만족도 검색" />

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="glass rounded-[20px] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">New Gift</p>
        <h1 className="mt-3 font-display text-3xl text-foreground">선물 기록</h1>
        <div className="mt-5 space-y-3">
          <select className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setPersonId(event.target.value)} value={personId}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setTitle(event.target.value)} placeholder="선물 이름" value={title} />
          <div className="grid gap-3 md:grid-cols-2">
            <select className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setDirection(event.target.value as "given" | "received")} value={direction}>
              <option value="given">준 선물</option>
              <option value="received">받은 선물</option>
            </select>
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setOccurredAt(event.target.value)} type="date" value={occurredAt} />
          </div>
          <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setSatisfaction(event.target.value)} placeholder="만족도 / 반응" value={satisfaction} />
          <button className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={isPending || !personId} onClick={submit} type="button">
            {isPending ? "저장 중..." : "선물 저장"}
          </button>
        </div>
        </div>

        <GiftBoard
          gifts={filteredGifts.filter((gift) => gift.direction === "given")}
          renderGift={(gift) => <GiftCard gift={gift} onDelete={() => removeGift(gift.id)} personName={peopleMap.get(gift.personId) ?? "Unknown"} />}
          title="준 선물"
        />
        <GiftBoard
          gifts={filteredGifts.filter((gift) => gift.direction === "received")}
          renderGift={(gift) => <GiftCard gift={gift} onDelete={() => removeGift(gift.id)} personName={peopleMap.get(gift.personId) ?? "Unknown"} />}
          title="받은 선물"
        />
      </section>
    </section>
  );
}
