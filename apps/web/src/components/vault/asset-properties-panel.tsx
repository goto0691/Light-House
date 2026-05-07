"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { AssetMock } from "@/lib/mock/vault";
import { ASSET_PROPERTY_DEFINITIONS, ASSET_PROPERTY_GROUPS } from "@/lib/properties/asset";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

type AssetPropertyForm = {
  name: string;
  category: AssetMock["category"];
  brand: string;
  modelName: string;
  acquiredDate: string;
  acquiredPrice: string;
  condition: string;
  notes: string;
};

const ASSET_SOURCE_TARGETS: Array<SourcePropertyTarget<AssetPropertyForm>> = [
  { value: "skip", label: "원본 유지" },
  { value: "name", label: "자산명", apply: ({ value }) => ({ name: compactSingleLine(value, 120) }) },
  { value: "category", label: "분류", apply: ({ form, value }) => ({ category: normalizeAssetCategory(value) ?? form.category }) },
  { value: "brand", label: "브랜드", apply: ({ value }) => ({ brand: compactSingleLine(value, 80) }) },
  { value: "modelName", label: "모델명", apply: ({ value }) => ({ modelName: compactSingleLine(value, 100) }) },
  { value: "condition", label: "현재 상태", apply: ({ value }) => ({ condition: normalizeCondition(value) }) },
  { value: "acquiredDate", label: "취득일", apply: ({ form, value }) => ({ acquiredDate: normalizeDate(value) ?? form.acquiredDate }) },
  { value: "acquiredPrice", label: "취득가", apply: ({ form, value }) => ({ acquiredPrice: normalizeNumberText(value) ?? form.acquiredPrice }) },
  { value: "notes", label: "메모", apply: ({ value }) => ({ notes: value.trim() }) },
];

export function AssetPropertiesPanel({ asset }: { asset: AssetMock }) {
  const [isPending, startTransition] = useTransition();
  const activeAsset = useVaultStore((state) => state.assets.find((item) => item.id === asset.id)) ?? asset;
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [form, setForm] = useState<AssetPropertyForm>(() => buildAssetPropertyForm(activeAsset));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedAssetId, setSyncedAssetId] = useState(activeAsset.id);

  useEffect(() => {
    if (isDirty && activeAsset.id === syncedAssetId) return;
    setForm(buildAssetPropertyForm(activeAsset));
    setSyncedAssetId(activeAsset.id);
    setIsDirty(false);
  }, [activeAsset, isDirty, syncedAssetId]);

  function saveProperties() {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/vault/assets/${activeAsset.id}/properties`,
          {
            ...form,
            acquiredPrice: optionalNumber(form.acquiredPrice),
          },
          replaceSnapshot,
        );
        setIsDirty(false);
        toast.success("자산 속성을 저장했습니다.");
      } catch (error) {
        toast.error("자산 속성 저장에 실패했습니다.", {
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
            <p className="text-xs tracking-[0.08em] text-primary">자산 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">자산의 canonical 필드를 같은 속성 문법으로 정리합니다.</p>
          </div>
          <button className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={isPending || !form.name.trim()} onClick={saveProperties} type="button">
            {isPending ? "저장 중..." : "속성 저장"}
          </button>
        </div>
      </section>
      <PropertyPanel
        definitions={ASSET_PROPERTY_DEFINITIONS}
        form={form}
        groups={ASSET_PROPERTY_GROUPS}
        onChange={(patch) => {
          setIsDirty(true);
          setForm((current) => ({ ...current, ...patch }));
        }}
      />
      <SourcePropertyInspector
        canonicalEntityType="asset"
        definitions={ASSET_PROPERTY_DEFINITIONS}
        form={form}
        onChange={(patch) => {
          setIsDirty(true);
          setForm((current) => ({ ...current, ...patch }));
        }}
        sourceDocument={activeAsset.sourceDocument}
        targets={ASSET_SOURCE_TARGETS}
      />
    </div>
  );
}

function buildAssetPropertyForm(asset: AssetMock): AssetPropertyForm {
  return {
    name: asset.name,
    category: asset.category,
    brand: asset.brand === "-" ? "" : asset.brand,
    modelName: asset.modelName ?? "",
    acquiredDate: asset.acquiredDate?.slice(0, 10) ?? "",
    acquiredPrice: asset.acquiredPrice ? String(asset.acquiredPrice) : "",
    condition: asset.condition === "-" ? "" : asset.condition,
    notes: asset.notes ?? "",
  };
}

function compactSingleLine(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

function normalizeAssetCategory(value: string): AssetMock["category"] | null {
  const text = normalize(value);
  if (text.includes("collection") || text.includes("수집")) return "collection";
  if (text.includes("gear") || text.includes("장비") || text.includes("기기")) return "gear";
  return null;
}

function normalizeCondition(value: string) {
  const text = normalize(value);
  if (text.includes("mint") || text.includes("최상")) return "mint";
  if (text.includes("good") || text.includes("양호")) return "good";
  if (text.includes("fair") || text.includes("보통")) return "fair";
  if (text.includes("repair") || text.includes("수리")) return "repair";
  return compactSingleLine(value, 40);
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
