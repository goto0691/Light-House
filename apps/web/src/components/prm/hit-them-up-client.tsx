"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Tag } from "@/components/shared/tag";
import { getPersonSummaryText } from "@/lib/display/person";
import type { PersonMock } from "@/lib/mock/prm";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { type PRMMutationDelta, usePRMStore } from "@/stores/use-prm-store";

export function HitThemUpClient({ people }: { people: PersonMock[] }) {
  const [isPending, startTransition] = useTransition();
  const [localPeople, setLocalPeople] = useState(people);
  const applyMutationDelta = usePRMStore((state) => state.applyMutationDelta);
  const duePeople = localPeople
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((left, right) => right.daysSinceContact - left.daysSinceContact);

  function applyContactDelta(delta: PRMMutationDelta) {
    applyMutationDelta(delta);
    if (delta.person) {
      setLocalPeople((current) => current.map((person) => (person.id === delta.person!.id ? delta.person! : person)));
    }
  }

  function markContacted(person: PersonMock) {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
          `/api/prm/people/${person.id}/contact`,
          undefined,
          applyContactDelta,
        );
        toast.success(`${person.name} 연락 완료로 기록했습니다.`);
      } catch (error) {
        toast.error("연락 완료 기록에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {duePeople.length ? (
        duePeople.map((person) => (
          <div className="rounded-lg border border-white/10 bg-white/5 p-5 hover:bg-white/8" key={person.id}>
            <Link href={`/prm?detail=person:${person.id}`} scroll={false}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl text-foreground">{person.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{person.groups.join(" · ")}</p>
                </div>
                <Tag value={`마지막 연락 ${person.daysSinceContact}일`} variant="status" />
              </div>
              <p className="mt-4 line-clamp-3 break-words text-sm leading-6 text-muted-foreground">{getPersonSummaryText(person)}</p>
            </Link>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Tag value={`연락 주기 ${person.cadenceDays}일`} variant="neutral" />
              <Tag value={`레이어 ${person.layer}`} variant="dunbar" />
              <button
                className="rounded-md border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
                disabled={isPending}
                onClick={() => markContacted(person)}
                type="button"
              >
                연락했음
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">연락 주기를 넘긴 사람이 없습니다.</div>
      )}
    </div>
  );
}
