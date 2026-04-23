"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { postSnapshotMutation } from "@/lib/snapshot-client";
import { usePRMStore } from "@/stores/use-prm-store";

export function PersonDrawer({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const person = usePRMStore((state) => state.people.find((item) => item.id === id));
  const gifts = usePRMStore((state) => state.gifts.filter((item) => item.personId === id));
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);
  const [interactionSummary, setInteractionSummary] = useState("");
  const [interactionType, setInteractionType] = useState("message");
  const [giftTitle, setGiftTitle] = useState("");
  const [giftDirection, setGiftDirection] = useState<"given" | "received">("given");

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

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Log Interaction</p>
          <div className="mt-4 space-y-3">
            <select className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setInteractionType(event.target.value)} value={interactionType}>
              <option value="message">메시지</option>
              <option value="meeting">미팅</option>
              <option value="call">통화</option>
            </select>
            <input className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setInteractionSummary(event.target.value)} placeholder="이번에 나눈 상호작용 요약" value={interactionSummary} />
            <button
              className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/prm/people/${id}/interactions`,
                      { summary: interactionSummary, type: interactionType },
                      replaceSnapshot,
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

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Add Gift</p>
          <div className="mt-4 space-y-3">
            <select className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setGiftDirection(event.target.value as "given" | "received")} value={giftDirection}>
              <option value="given">준 선물</option>
              <option value="received">받은 선물</option>
            </select>
            <input className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setGiftTitle(event.target.value)} placeholder="선물 이름" value={giftTitle} />
            <button
              className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/prm/people/${id}/gifts`,
                      { title: giftTitle, direction: giftDirection },
                      replaceSnapshot,
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
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Gifts</p>
          <span className="text-xs text-muted-foreground">{gifts.length} items</span>
        </div>
        <div className="mt-4 space-y-3">
          {gifts.length ? (
            gifts.map((gift) => (
              <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3" key={gift.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{gift.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {gift.direction === "given" ? "준 선물" : "받은 선물"} · {gift.occurredAt}
                    </p>
                  </div>
                  <button
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/prm/gifts/${gift.id}/delete`,
                            undefined,
                            replaceSnapshot,
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

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Timeline</p>
        <div className="mt-4 space-y-3">
          {person.timeline.map((item) => (
            <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3" key={item.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{item.kind}</span>
                  {item.kind === "interaction" ? (
                    <button
                      className="rounded-xl border border-white/10 px-2 py-1 text-[11px] text-muted-foreground"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                              `/api/prm/interactions/${item.id}/delete`,
                              undefined,
                              replaceSnapshot,
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
                      className="rounded-xl border border-white/10 px-2 py-1 text-[11px] text-muted-foreground"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                              `/api/prm/gifts/${item.id}/delete`,
                              undefined,
                              replaceSnapshot,
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
