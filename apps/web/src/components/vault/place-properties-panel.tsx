"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { PlaceMock } from "@/lib/mock/vault";
import { PLACE_PROPERTY_DEFINITIONS, PLACE_PROPERTY_GROUPS } from "@/lib/properties/place";
import { postSnapshotMutation } from "@/lib/snapshot-client";
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
  const activePlace = useVaultStore((state) => state.places.find((item) => item.id === place.id)) ?? place;
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [form, setForm] = useState<PlacePropertyForm>(() => buildPlacePropertyForm(activePlace));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedPlaceId, setSyncedPlaceId] = useState(activePlace.id);

  useEffect(() => {
    if (isDirty && activePlace.id === syncedPlaceId) return;
    setForm(buildPlacePropertyForm(activePlace));
    setSyncedPlaceId(activePlace.id);
    setIsDirty(false);
  }, [activePlace, isDirty, syncedPlaceId]);

  function saveProperties() {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/vault/places/${activePlace.id}/properties`,
          {
            ...form,
            visitCount: optionalNumber(form.visitCount),
            averageRating: optionalNumber(form.averageRating),
          },
          replaceSnapshot,
        );
        setIsDirty(false);
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
            <p className="mt-1 text-sm text-muted-foreground">장소의 위치, 방문 정보, 메모를 canonical 속성으로 관리합니다.</p>
          </div>
          <button className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={isPending || !form.name.trim()} onClick={saveProperties} type="button">
            {isPending ? "저장 중..." : "속성 저장"}
          </button>
        </div>
      </section>
      <PropertyPanel
        definitions={PLACE_PROPERTY_DEFINITIONS}
        form={form}
        groups={PLACE_PROPERTY_GROUPS}
        onChange={(patch) => {
          setIsDirty(true);
          setForm((current) => ({ ...current, ...patch }));
        }}
      />
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
