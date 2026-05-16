"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import { getPersonSummaryText } from "@/lib/display/person";
import type { PersonMock } from "@/lib/mock/prm";
import { PERSON_PROPERTY_DEFINITIONS, PERSON_PROPERTY_GROUPS } from "@/lib/properties/person";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { type PRMMutationDelta, usePRMStore } from "@/stores/use-prm-store";

export type PersonPropertyMode = "summary" | "edit" | "source";

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

type PersonPropertiesPanelProps = {
  person: PersonMock;
  allowedModes?: PersonPropertyMode[];
  deferSourceDocument?: boolean;
  defaultMode?: PersonPropertyMode;
  extraAction?: ReactNode;
};

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
  { value: "birthdayMemo", label: "생일 기록", apply: ({ value }) => ({ birthdayMemo: compactSingleLine(value, 160) }) },
  { value: "phone", label: "전화", apply: ({ value }) => ({ phone: compactSingleLine(value, 80) }) },
  { value: "email", label: "이메일", apply: ({ value }) => ({ email: compactSingleLine(value, 120) }) },
  { value: "address", label: "주소", apply: ({ value }) => ({ address: compactSingleLine(value, 200) }) },
  { value: "socialLinks", label: "소셜 링크", apply: ({ value }) => ({ socialLinks: compactSingleLine(value, 240) }) },
  { value: "coreValue", label: "핵심 가치", apply: ({ value }) => ({ coreValue: value.trim() }) },
  { value: "bio", label: "소개", apply: ({ value }) => ({ bio: value.trim() }) },
  { value: "profileBody", label: "프로필 본문", apply: ({ value }) => ({ profileBody: value.trim() }) },
];

export function PersonPropertiesPanel({
  allowedModes = ["summary", "edit", "source"],
  defaultMode,
  deferSourceDocument = false,
  extraAction,
  person,
}: PersonPropertiesPanelProps) {
  const [isPending, startTransition] = useTransition();
  const activePerson = usePRMStore((state) => state.people.find((item) => item.id === person.id)) ?? person;
  const applyMutationDelta = usePRMStore((state) => state.applyMutationDelta);
  const initialMode = allowedModes.includes(defaultMode ?? "summary") ? defaultMode ?? "summary" : allowedModes[0] ?? "summary";
  const [mode, setMode] = useState<PersonPropertyMode>(initialMode);
  const [form, setForm] = useState<PersonProfileForm>(() => buildProfileForm(activePerson));
  const [isDirty, setIsDirty] = useState(false);
  const [isSourceLoading, setIsSourceLoading] = useState(false);
  const [sourceDocument, setSourceDocument] = useState<PersonMock["sourceDocument"]>(() => (deferSourceDocument ? null : activePerson.sourceDocument));
  const [sourceLoaded, setSourceLoaded] = useState(!deferSourceDocument);
  const [syncedPersonId, setSyncedPersonId] = useState(activePerson.id);

  useEffect(() => {
    if (isDirty && activePerson.id === syncedPersonId) return;
    setForm(buildProfileForm(activePerson));
    setSyncedPersonId(activePerson.id);
    setIsDirty(false);
    setMode(initialMode);
  }, [activePerson, initialMode, isDirty, syncedPersonId]);

  useEffect(() => {
    setSourceDocument(deferSourceDocument ? null : activePerson.sourceDocument);
    setSourceLoaded(!deferSourceDocument);
  }, [activePerson.id, activePerson.sourceDocument, deferSourceDocument]);

  useEffect(() => {
    if (!deferSourceDocument || mode !== "source" || sourceLoaded) return;
    let cancelled = false;
    setIsSourceLoading(true);
    fetch(`/api/prm/people/${encodeURIComponent(activePerson.id)}/source-document`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("원본 속성을 불러오지 못했습니다.");
        return (await response.json()) as { sourceDocument: PersonMock["sourceDocument"] };
      })
      .then((payload) => {
        if (!cancelled) {
          setSourceDocument(payload.sourceDocument ?? null);
          setSourceLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setSourceLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setIsSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePerson.id, deferSourceDocument, mode, sourceLoaded]);

  function updateForm(patch: Partial<PersonProfileForm>) {
    setIsDirty(true);
    setForm((current) => ({ ...current, ...patch }));
  }

  function saveProfile() {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: PRMMutationDelta }, PRMMutationDelta>(
          `/api/prm/people/${activePerson.id}/profile`,
          {
            name: form.name,
            nickname: form.nickname,
            aliases: form.aliases.join(", "),
            birthDate: form.birthDate,
            birthdayMemo: form.birthdayMemo,
            groups: form.groups,
            dunbarLayer: optionalNumber(form.dunbarLayer),
            intimacy: optionalNumber(form.intimacy),
            coreValue: form.coreValue,
            bio: form.bio,
            profileBody: form.profileBody,
            contactCadenceDays: optionalNumber(form.contactCadenceDays),
            phone: form.phone,
            email: form.email,
            address: form.address,
            socialLinks: form.socialLinks,
            status: form.status,
          },
          applyMutationDelta,
        );
        setIsDirty(false);
        setMode(allowedModes.includes("summary") ? "summary" : mode);
        toast.success("인물 프로필을 저장했습니다.");
      } catch (error) {
        toast.error("인물 프로필 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">관계 속성</p>
            <h4 className="mt-2 text-lg font-semibold text-foreground">관계 속성</h4>
            <p className="mt-1 text-sm text-muted-foreground">요약으로 먼저 보고, 필요할 때만 전용 편집 화면에서 정리합니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {allowedModes.length > 1
              ? allowedModes.map((key) => (
                  <button
                    aria-pressed={mode === key}
                    className={`focus-ring min-h-9 rounded-md border px-3 py-1.5 text-xs ${
                      mode === key ? "border-primary/25 bg-primary/10 text-primary" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground"
                    }`}
                    key={key}
                    onClick={() => setMode(key)}
                    type="button"
                  >
                    {personModeLabel(key)}
                  </button>
                ))
              : null}
            {mode === "edit" || mode === "source" ? (
              <button
                className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                disabled={isPending || !form.name.trim()}
                onClick={saveProfile}
                type="button"
              >
                {isPending ? "저장 중..." : "프로필 저장"}
              </button>
            ) : null}
            {extraAction}
          </div>
        </div>
      </section>

      {mode === "summary" ? (
        <section className="rounded-lg border border-white/10 bg-white/5 p-4">
          <PropertySummary
            definitions={PERSON_PROPERTY_DEFINITIONS}
            groups={PERSON_PROPERTY_GROUPS}
            mode="detail"
            record={activePerson}
            title="관계 속성 요약"
            valueOverrides={{
              aliases: splitList(activePerson.aliases ?? ""),
              bio: getPersonSummaryText(activePerson, { maxLength: 220 }),
              contactCadenceDays: activePerson.cadenceDays,
              dunbarLayer: String(activePerson.layer),
              profileBody: activePerson.profileBody ? getPersonSummaryText({ bio: activePerson.profileBody }, { maxLength: 220 }) : "",
            }}
          />
        </section>
      ) : null}

      {mode === "edit" ? (
        <PropertyPanel
          definitions={PERSON_PROPERTY_DEFINITIONS}
          form={form}
          groups={PERSON_PROPERTY_GROUPS}
          onChange={updateForm}
        />
      ) : null}

      {mode === "source" ? (
        isSourceLoading ? (
          <section className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">원본 속성을 불러오는 중입니다.</section>
        ) : sourceDocument ? (
          <SourcePropertyInspector
            canonicalEntityType="person"
            definitions={PERSON_PROPERTY_DEFINITIONS}
            form={form}
            onChange={updateForm}
            sourceDocument={sourceDocument}
            targets={PERSON_SOURCE_TARGETS}
          />
        ) : (
          <section className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">연결된 원본 속성이 없습니다.</section>
        )
      ) : null}
    </div>
  );
}

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

function personModeLabel(mode: PersonPropertyMode) {
  if (mode === "edit") return "편집";
  if (mode === "source") return "원본";
  return "요약";
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
