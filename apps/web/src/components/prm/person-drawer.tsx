"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { PersonPropertiesPanel } from "@/components/prm/person-properties-panel";
import type { PersonMock } from "@/lib/mock/prm";
import { getPersonSummaryText } from "@/lib/display/person";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { type PRMMutationDelta, usePRMStore } from "@/stores/use-prm-store";

type PersonDrawerSection = "records" | "properties" | "timeline";
type PersonTimelineKind = PersonMock["timeline"][number]["kind"];

const PERSON_TIMELINE_KIND_LABELS = {
  interaction: "상호작용",
  gift: "선물",
  task: "작업",
  zettel: "지식",
  daily_entry: "일일 기록",
} satisfies Record<PersonTimelineKind, string>;

function getTimelineKindLabel(kind: PersonTimelineKind) {
  return PERSON_TIMELINE_KIND_LABELS[kind];
}

export function PersonDrawer({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const person = usePRMStore((state) => state.people.find((item) => item.id === id));
  const allGifts = usePRMStore((state) => state.gifts);
  const applyMutationDelta = usePRMStore((state) => state.applyMutationDelta);
  const gifts = useMemo(() => allGifts.filter((item) => item.personId === id), [allGifts, id]);
  const summary = person ? getPersonSummaryText(person, { maxLength: 240 }) : "";
  const [interactionSummary, setInteractionSummary] = useState("");
  const [interactionType, setInteractionType] = useState("message");
  const [giftTitle, setGiftTitle] = useState("");
  const [giftDirection, setGiftDirection] = useState<"given" | "received">("given");
  const [section, setSection] = useState<PersonDrawerSection>("records");

  if (!person) {
    return (
      <section className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
        인물 데이터를 찾지 못했습니다.
      </section>
    );
  }

  return (
    <ContextBundlePanel
      density="drawer"
      enableAttach
      entityId={id}
      entityType="person"
      mainSlot={() => (
        <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">관계 요약</p>
        <h3 className="mt-2 text-2xl font-semibold text-foreground">{person.name}</h3>
        <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-muted-foreground">{summary}</p>
        <div className="mt-4 flex gap-2">
          <button
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                    `/api/prm/people/${id}/contact`,
                    undefined,
                    applyMutationDelta,
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
            className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                    `/api/prm/people/${id}/favorite`,
                    undefined,
                    applyMutationDelta,
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
            <span className="rounded-md bg-white/8 px-3 py-1 text-xs text-foreground" key={group}>
              {group}
            </span>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="선물" value={String(person.giftsCount)} />
        <MetricCard label="상호작용" value={String(person.interactionsCount)} />
        <MetricCard label="작업" value={String(person.tasksCount)} />
      </section>

      <div className="flex rounded-lg border border-white/10 bg-black/10 p-1">
        {([
          ["records", "기록"],
          ["properties", "속성"],
          ["timeline", "타임라인"],
        ] as const).map(([key, label]) => (
          <button
            aria-pressed={section === key}
            className={`focus-ring min-h-10 flex-1 rounded-md px-3 py-2 text-xs font-medium ${
              section === key ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"
            }`}
            key={key}
            onClick={() => setSection(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {section === "records" ? (
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-xs tracking-[0.08em] text-primary">상호작용 기록</p>
          <div className="mt-4 space-y-3">
            <select className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setInteractionType(event.target.value)} value={interactionType}>
              <option value="message">메시지</option>
              <option value="meeting">미팅</option>
              <option value="call">통화</option>
            </select>
            <input className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setInteractionSummary(event.target.value)} placeholder="이번에 나눈 상호작용 요약" value={interactionSummary} />
            <button
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                      `/api/prm/people/${id}/interactions`,
                      { summary: interactionSummary, type: interactionType },
                      applyMutationDelta,
                    );
                    setInteractionSummary("");
                    toast.success("상호작용을 기록했습니다.");
                  } catch (error) {
                    toast.error("상호작용 저장에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              상호작용 저장
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-xs tracking-[0.08em] text-primary">선물 추가</p>
          <div className="mt-4 space-y-3">
            <select className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setGiftDirection(event.target.value as "given" | "received")} value={giftDirection}>
              <option value="given">준 선물</option>
              <option value="received">받은 선물</option>
            </select>
            <input className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setGiftTitle(event.target.value)} placeholder="선물 이름" value={giftTitle} />
            <button
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                      `/api/prm/people/${id}/gifts`,
                      { title: giftTitle, direction: giftDirection },
                      applyMutationDelta,
                    );
                    setGiftTitle("");
                    toast.success("선물을 기록했습니다.");
                  } catch (error) {
                    toast.error("선물 저장에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              선물 저장
            </button>
          </div>
        </div>
      </section>
      ) : null}

      {section === "properties" ? (
        <PersonPropertiesPanel
          allowedModes={["summary"]}
          extraAction={
            <Link
              className="focus-ring rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-white/8 hover:text-foreground"
              href={`/prm/${person.id}/edit`}
              scroll={false}
            >
              편집 화면
            </Link>
          }
          person={person}
        />
      ) : null}

      {section === "records" ? (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tracking-[0.08em] text-primary">선물</p>
          <span className="text-xs text-muted-foreground">{gifts.length}개</span>
        </div>
        <div className="mt-4 space-y-3">
          {gifts.length ? (
            gifts.map((gift) => (
              <div className="rounded-md border border-white/10 bg-black/10 px-3 py-3" key={gift.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{gift.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {gift.direction === "given" ? "준 선물" : "받은 선물"} · {gift.occurredAt}
                    </p>
                  </div>
                  <button
                    className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                            `/api/prm/gifts/${gift.id}/delete`,
                            undefined,
                            applyMutationDelta,
                          );
                          toast.success("선물을 제거했습니다.");
                        } catch (error) {
                          toast.error("선물 삭제에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">아직 기록된 선물이 없습니다.</p>
          )}
        </div>
      </section>
      ) : null}

      {section === "timeline" ? (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">타임라인</p>
        <div className="mt-4 space-y-3">
          {person.timeline.map((item) => (
            <div className="rounded-md border border-white/10 bg-black/10 px-3 py-3" key={item.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">{getTimelineKindLabel(item.kind)}</span>
                  {item.kind === "interaction" ? (
                    <button
                      className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted-foreground"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                              `/api/prm/interactions/${item.id}/delete`,
                              undefined,
                              applyMutationDelta,
                            );
                            toast.success("상호작용을 제거했습니다.");
                          } catch (error) {
                            toast.error("상호작용 삭제에 실패했습니다.", {
                              description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                            });
                          }
                        });
                      }}
                      type="button"
                    >
                      삭제
                    </button>
                  ) : null}
                  {item.kind === "gift" ? (
                    <button
                      className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted-foreground"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
                              `/api/prm/gifts/${item.id}/delete`,
                              undefined,
                              applyMutationDelta,
                            );
                            toast.success("선물을 제거했습니다.");
                          } catch (error) {
                            toast.error("선물 삭제에 실패했습니다.", {
                              description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                            });
                          }
                        });
                      }}
                      type="button"
                    >
                      삭제
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      ) : null}
    </div>
      )}
      railDefaultLens="people"
    />
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
