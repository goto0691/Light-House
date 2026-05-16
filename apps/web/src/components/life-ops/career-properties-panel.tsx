"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { buildCareerPropertyForm, careerPropertyPayload, type CareerPropertyForm } from "@/components/life-ops/career-property-form";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import type { CareerLog } from "@/lib/mock/life-ops";
import { CAREER_PROPERTY_DEFINITIONS, CAREER_PROPERTY_GROUPS } from "@/lib/properties/career";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore, type LifeOpsMutationDelta } from "@/stores/use-life-ops-store";

type CareerPropertiesPanelProps = {
  item: CareerLog;
};

export function CareerPropertiesPanel({ item }: CareerPropertiesPanelProps) {
  const [isPending, startTransition] = useTransition();
  const activeCareer = useLifeOpsStore((state) => state.career.find((career) => career.id === item.id)) ?? item;
  const applyMutationDelta = useLifeOpsStore((state) => state.applyMutationDelta);
  const [form, setForm] = useState<CareerPropertyForm>(() => buildCareerPropertyForm(activeCareer));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedCareerId, setSyncedCareerId] = useState(activeCareer.id);

  useEffect(() => {
    if (isDirty && activeCareer.id === syncedCareerId) return;
    setForm(buildCareerPropertyForm(activeCareer));
    setSyncedCareerId(activeCareer.id);
    setIsDirty(false);
  }, [activeCareer, isDirty, syncedCareerId]);

  const updateForm = (patch: Partial<CareerPropertyForm>) => {
    setIsDirty(true);
    setForm((current) => ({ ...current, ...patch }));
  };

  const saveProperties = () => {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
          `/api/life-ops/career/${activeCareer.id}/properties`,
          careerPropertyPayload(form),
          applyMutationDelta,
        );
        setIsDirty(false);
        toast.success("커리어 속성을 저장했습니다.");
      } catch (error) {
        toast.error("커리어 속성 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">커리어 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">조직, 역할, 분류, 기간, 설명을 기준 필드로 정리합니다.</p>
          </div>
          <button
            className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={isPending || !form.organization.trim() || !form.role.trim()}
            onClick={saveProperties}
            type="button"
          >
            {isPending ? "저장 중..." : "속성 저장"}
          </button>
        </div>
      </section>
      <PropertyPanel definitions={CAREER_PROPERTY_DEFINITIONS} form={form} groups={CAREER_PROPERTY_GROUPS} onChange={updateForm} />
    </div>
  );
}
