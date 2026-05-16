"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { PlaceMock } from "@/lib/mock/vault";
import { PLACE_PROPERTY_DEFINITIONS, PLACE_PROPERTY_GROUPS } from "@/lib/properties/place";
import { postJsonMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

type PlacePropertyForm = {
  name: string;
  category: PlaceMock["category"];
  address: string;
  mapUrl: string;
  firstVisitedAt: string;
  lastVisitedAt: string;
  visitCount: string;
  averageRating: string;
  review: string;
};

type PlacePropertyMode = "summary" | "detail" | "edit" | "source";

const PLACE_SOURCE_TARGETS: Array<SourcePropertyTarget<PlacePropertyForm>> = [
  { value: "skip", label: "원본 유지" },
  { value: "name", label: "장소명", apply: ({ value }) => ({ name: compactSingleLine(value, 120) }) },
  { value: "category", label: "분류", apply: ({ form, value }) => ({ category: normalizePlaceCategory(value) ?? form.category }) },
  { value: "address", label: "주소", apply: ({ value }) => ({ address: compactSingleLine(value, 180) }) },
  { value: "mapUrl", label: "지도 링크", apply: ({ value }) => ({ mapUrl: compactSingleLine(value, 240) }) },
  { value: "firstVisitedAt", label: "첫 방문일", apply: ({ form, value }) => ({ firstVisitedAt: normalizeDate(value) ?? form.firstVisitedAt }) },
  { value: "lastVisitedAt", label: "최근 방문일", apply: ({ form, value }) => ({ lastVisitedAt: normalizeDate(value) ?? form.lastVisitedAt }) },
  { value: "visitCount", label: "방문 수", apply: ({ form, value }) => ({ visitCount: normalizeNumberText(value) ?? form.visitCount }) },
  { value: "averageRating", label: "평균 평점", apply: ({ form, value }) => ({ averageRating: normalizeNumberText(value) ?? form.averageRating }) },
  { value: "review", label: "장소 메모", apply: ({ value }) => ({ review: value.trim() }) },
];

export function PlacePropertiesPanel({ place }: { place: PlaceMock }) {
  const [isPending, startTransition] = useTransition();
  const upsertPlace = useVaultStore((state) => state.upsertPlace);
  const [activePlace, setActivePlace] = useState(place);
  const [form, setForm] = useState<PlacePropertyForm>(() => buildPlacePropertyForm(activePlace));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedPlaceId, setSyncedPlaceId] = useState(activePlace.id);
  const [mode, setMode] = useState<PlacePropertyMode>("summary");

  useEffect(() => {
    setActivePlace(place);
  }, [place]);

  useEffect(() => {
    if (isDirty && activePlace.id === syncedPlaceId) return;
    setForm(buildPlacePropertyForm(activePlace));
    setSyncedPlaceId(activePlace.id);
    setIsDirty(false);
  }, [activePlace, isDirty, syncedPlaceId]);

  function saveProperties() {
    startTransition(async () => {
      try {
        const payload = await postJsonMutation<{ place: PlaceMock }>(`/api/vault/places/${activePlace.id}/properties`, {
          ...form,
          visitCount: optionalNumber(form.visitCount),
          averageRating: optionalNumber(form.averageRating),
        });
        if (payload.place) {
          setActivePlace(payload.place);
          upsertPlace(payload.place);
        }
        setIsDirty(false);
        setMode("summary");
        toast.success("장소 속성을 저장했습니다.");
      } catch (error) {
        toast.error("장소 속성 저장에 실패했습니다.", {
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
            <p className="text-xs tracking-[0.08em] text-primary">장소 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">위치와 방문 정보를 요약으로 먼저 보고, 필요할 때만 편집합니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["summary", "요약"],
              ["detail", "상세"],
              ["edit", "편집"],
              ["source", "원본"],
            ] as const).map(([key, label]) => (
              <button
                aria-pressed={mode === key}
                className={`focus-ring min-h-9 rounded-md border px-3 py-1.5 text-xs ${
                  mode === key ? "border-primary/25 bg-primary/10 text-primary" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground"
                }`}
                key={key}
                onClick={() => setMode(key)}
                type="button"
              >
                {label}
              </button>
            ))}
            {mode === "edit" || mode === "source" ? (
              <button className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={isPending || !form.name.trim()} onClick={saveProperties} type="button">
                {isPending ? "저장 중..." : "속성 저장"}
              </button>
            ) : null}
          </div>
        </div>
      </section>
      {mode === "summary" || mode === "detail" ? (
        <section className="rounded-lg border border-white/10 bg-white/5 p-4">
          <PropertySummary
            definitions={PLACE_PROPERTY_DEFINITIONS}
            groups={PLACE_PROPERTY_GROUPS}
            mode={mode === "summary" ? "list" : "all"}
            record={activePlace}
            title={mode === "summary" ? "핵심 속성" : "전체 속성"}
          />
        </section>
      ) : null}
      {mode === "edit" ? (
        <PropertyPanel
          definitions={PLACE_PROPERTY_DEFINITIONS}
          form={form}
          groups={PLACE_PROPERTY_GROUPS}
          onChange={(patch) => {
            setIsDirty(true);
            setForm((current) => ({ ...current, ...patch }));
          }}
        />
      ) : null}
      {mode === "source" ? (
        <SourcePropertyInspector
          canonicalEntityType="place"
          definitions={PLACE_PROPERTY_DEFINITIONS}
          form={form}
          onChange={(patch) => {
            setIsDirty(true);
            setForm((current) => ({ ...current, ...patch }));
          }}
          sourceDocument={activePlace.sourceDocument}
          targets={PLACE_SOURCE_TARGETS}
        />
      ) : null}
    </div>
  );
}

function buildPlacePropertyForm(place: PlaceMock): PlacePropertyForm {
  return {
    name: place.name,
    category: place.category,
    address: place.address,
    mapUrl: place.mapUrl ?? "",
    firstVisitedAt: place.firstVisitedAt?.slice(0, 10) ?? "",
    lastVisitedAt: place.lastVisitedAt?.slice(0, 10) ?? "",
    visitCount: typeof place.visitCount === "number" ? String(place.visitCount) : "",
    averageRating: typeof place.averageRating === "number" ? String(place.averageRating) : "",
    review: place.review,
  };
}

function compactSingleLine(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

function normalizePlaceCategory(value: string): PlaceMock["category"] | null {
  const text = normalize(value);
  if (text.includes("restaurant") || text.includes("식당") || text.includes("음식")) return "restaurant";
  if (text.includes("cafe") || text.includes("카페")) return "cafe";
  if (text.includes("shop") || text.includes("상점") || text.includes("공간") || text.includes("전시")) return "shop";
  return null;
}

function normalizeDate(value: string) {
  const match = value.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/);
  if (!match) return null;
  const [year, month, day] = match[0].split(/[-./]/);
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeNumberText(value: string) {
  const match = value.replaceAll(",", "").match(/-?\d+(\.\d+)?/);
  return match?.[0] ?? null;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
