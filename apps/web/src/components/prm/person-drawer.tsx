"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { PersonMock } from "@/lib/mock/prm";
import { PERSON_PROPERTY_DEFINITIONS, PERSON_PROPERTY_GROUPS } from "@/lib/properties/person";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { usePRMStore } from "@/stores/use-prm-store";

type PersonProfileForm = {
  name: string;
  nickname: string;
  aliases: string[];
  birthDate: string;
  birthdayMemo: string;
  groups: string[];
  dunbarLayer: string;
  intimacy: string;
  coreValue: string;
  bio: string;
  profileBody: string;
  contactCadenceDays: string;
  phone: string;
  email: string;
  address: string;
  socialLinks: string;
  status: PersonMock["status"];
};

type PersonSourcePropertyTarget =
  | "skip"
  | "name"
  | "nickname"
  | "aliases"
  | "groups"
  | "status"
  | "dunbarLayer"
  | "intimacy"
  | "contactCadenceDays"
  | "birthDate"
  | "birthdayMemo"
  | "phone"
  | "email"
  | "address"
  | "socialLinks"
  | "coreValue"
  | "bio"
  | "profileBody";

const PERSON_SOURCE_TARGETS: Array<SourcePropertyTarget<PersonProfileForm> & { value: PersonSourcePropertyTarget }> = [
  { value: "skip", label: "원본 유지" },
  { value: "name", label: "이름", apply: ({ value }) => ({ name: compactSingleLine(value, 120) }) },
  { value: "nickname", label: "닉네임", apply: ({ value }) => ({ nickname: compactSingleLine(value, 80) }) },
  { value: "aliases", label: "별칭", apply: ({ form, value }) => ({ aliases: mergeList(form.aliases, value) }) },
  { value: "groups", label: "그룹", apply: ({ form, value }) => ({ groups: mergeList(form.groups, value) }) },
  { value: "status", label: "관계 상태", apply: ({ form, value }) => ({ status: normalizePersonStatus(value) ?? form.status }) },
  { value: "dunbarLayer", label: "관계 레이어", apply: ({ form, value }) => ({ dunbarLayer: normalizeLayer(value) ?? form.dunbarLayer }) },
  { value: "intimacy", label: "친밀도", apply: ({ form, value }) => ({ intimacy: normalizeNumberText(value) ?? form.intimacy }) },
  { value: "contactCadenceDays", label: "연락 주기", apply: ({ form, value }) => ({ contactCadenceDays: normalizeNumberText(value) ?? form.contactCadenceDays }) },
  { value: "birthDate", label: "생일", apply: ({ form, value }) => ({ birthDate: normalizeDate(value) ?? form.birthDate }) },
  { value: "birthdayMemo", label: "생일 메모", apply: ({ value }) => ({ birthdayMemo: compactSingleLine(value, 160) }) },
  { value: "phone", label: "전화", apply: ({ value }) => ({ phone: compactSingleLine(value, 80) }) },
  { value: "email", label: "이메일", apply: ({ value }) => ({ email: compactSingleLine(value, 120) }) },
  { value: "address", label: "주소", apply: ({ value }) => ({ address: compactSingleLine(value, 200) }) },
  { value: "socialLinks", label: "소셜 링크", apply: ({ value }) => ({ socialLinks: compactSingleLine(value, 240) }) },
  { value: "coreValue", label: "핵심 가치", apply: ({ value }) => ({ coreValue: value.trim() }) },
  { value: "bio", label: "소개", apply: ({ value }) => ({ bio: value.trim() }) },
  { value: "profileBody", label: "프로필 본문", apply: ({ value }) => ({ profileBody: value.trim() }) },
];

function buildProfileForm(person: PersonMock): PersonProfileForm {
  return {
    name: person.name,
    nickname: person.nickname ?? "",
    aliases: splitList(person.aliases ?? ""),
    birthDate: person.birthDate?.slice(0, 10) ?? "",
    birthdayMemo: person.birthdayMemo ?? "",
    groups: person.groups,
    dunbarLayer: String(person.layer),
    intimacy: person.intimacy ? String(person.intimacy) : "",
    coreValue: person.coreValue === "기록 중" ? "" : person.coreValue,
    bio: person.bio === "설명이 아직 없습니다." ? "" : person.bio,
    profileBody: person.profileBody ?? "",
    contactCadenceDays: String(person.cadenceDays),
    phone: person.phone ?? "",
    email: person.email ?? "",
    address: person.address ?? "",
    socialLinks: person.socialLinks ?? "",
    status: person.status,
  };
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function PersonDrawer({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const person = usePRMStore((state) => state.people.find((item) => item.id === id));
  const allGifts = usePRMStore((state) => state.gifts);
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);
  const gifts = useMemo(() => allGifts.filter((item) => item.personId === id), [allGifts, id]);
  const [interactionSummary, setInteractionSummary] = useState("");
  const [interactionType, setInteractionType] = useState("message");
  const [giftTitle, setGiftTitle] = useState("");
  const [giftDirection, setGiftDirection] = useState<"given" | "received">("given");
  const [profileForm, setProfileForm] = useState<PersonProfileForm | null>(person ? buildProfileForm(person) : null);

  useEffect(() => {
    setProfileForm(person ? buildProfileForm(person) : null);
  }, [person]);

  if (!person) {
    return (
      <section className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
        인물 데이터를 찾지 못했습니다.
      </section>
    );
  }

  const saveProfile = () => {
    if (!profileForm) return;
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/prm/people/${id}/profile`,
          {
            name: profileForm.name,
            nickname: profileForm.nickname,
            aliases: profileForm.aliases.join(", "),
            birthDate: profileForm.birthDate,
            birthdayMemo: profileForm.birthdayMemo,
            groups: profileForm.groups,
            dunbarLayer: optionalNumber(profileForm.dunbarLayer),
            intimacy: optionalNumber(profileForm.intimacy),
            coreValue: profileForm.coreValue,
            bio: profileForm.bio,
            profileBody: profileForm.profileBody,
            contactCadenceDays: optionalNumber(profileForm.contactCadenceDays),
            phone: profileForm.phone,
            email: profileForm.email,
            address: profileForm.address,
            socialLinks: profileForm.socialLinks,
            status: profileForm.status,
          },
          replaceSnapshot,
        );
        toast.success("인물 프로필을 저장했습니다.");
      } catch (error) {
        toast.error("인물 프로필 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <ContextBundlePanel
      density="drawer"
      enableAttach
      entityId={id}
      entityType="person"
      mainSlot={() => (
        <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">관계</p>
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
        <MetricCard label="선물" value={String(person.giftsCount)} />
        <MetricCard label="상호작용" value={String(person.interactionsCount)} />
        <MetricCard label="작업" value={String(person.tasksCount)} />
      </section>

      {profileForm ? (
        <SourcePropertyInspector
          canonicalEntityType="person"
          definitions={PERSON_PROPERTY_DEFINITIONS}
          form={profileForm}
          onChange={(patch) => setProfileForm({ ...profileForm, ...patch })}
          sourceDocument={person.sourceDocument}
          targets={PERSON_SOURCE_TARGETS}
        />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs tracking-[0.08em] text-primary">상호작용 기록</p>
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
          <p className="text-xs tracking-[0.08em] text-primary">선물 추가</p>
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

      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">정규 속성</p>
            <h4 className="mt-2 text-lg font-semibold text-foreground">관계 속성</h4>
          </div>
          {profileForm ? (
            <button
              className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              disabled={isPending}
              onClick={saveProfile}
              type="button"
            >
              프로필 저장
            </button>
          ) : null}
        </div>
      </section>
      {profileForm ? (
        <PropertyPanel
          definitions={PERSON_PROPERTY_DEFINITIONS}
          form={profileForm}
          groups={PERSON_PROPERTY_GROUPS}
          onChange={(patch) => setProfileForm({ ...profileForm, ...patch })}
        />
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tracking-[0.08em] text-primary">선물</p>
          <span className="text-xs text-muted-foreground">{gifts.length}개</span>
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
        <p className="text-xs tracking-[0.08em] text-primary">타임라인</p>
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
      )}
      railDefaultLens="people"
    />
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function splitList(value: string) {
  return value
    .split(/[,;/\n|]+/)
    .map((item) => compactSingleLine(item, 80))
    .filter(Boolean);
}

function mergeList(current: string[], value: string) {
  const unique = new Map(current.map((item) => [normalize(item), item]));
  for (const item of splitList(value)) {
    const key = normalize(item);
    if (key && !unique.has(key)) unique.set(key, item);
  }
  return Array.from(unique.values());
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

function compactSingleLine(value: string, limit: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > limit ? compacted.slice(0, limit).trim() : compacted;
}

function normalizePersonStatus(value: string): PersonMock["status"] | null {
  const normalized = normalize(value);
  if (["active", "활성"].includes(normalized)) return "active";
  if (["dormant", "inactive", "sleeping", "휴면", "비활성"].includes(normalized)) return "dormant";
  if (["observing", "observe", "watching", "관찰", "관찰 중", "관찰중"].includes(normalized)) return "observing";
  return null;
}

function normalizeLayer(value: string) {
  const match = value.match(/\b(5|15|50|150)\b/);
  return match?.[1] ?? null;
}

function normalizeNumberText(value: string) {
  const match = value.replaceAll(",", "").match(/-?\d+(\.\d+)?/);
  return match?.[0] ?? null;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const koreanMatch = trimmed.match(/\b(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\b/);
  if (koreanMatch) {
    const [, year, month, day] = koreanMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
