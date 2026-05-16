"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CareerNode } from "@/components/life-ops/career-node";
import { buildCareerPropertyForm, careerPropertyPayload, type CareerPropertyForm } from "@/components/life-ops/career-property-form";
import { FilterBar } from "@/components/shared/filter-bar";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { CAREER_CATEGORY_OPTIONS, CAREER_PROPERTY_DEFINITIONS, CAREER_PROPERTY_GROUPS } from "@/lib/properties/career";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore, type LifeOpsMutationDelta } from "@/stores/use-life-ops-store";

export function CareerClient() {
  const [isPending, startTransition] = useTransition();
  const career = useLifeOpsStore((state) => state.career);
  const applyMutationDelta = useLifeOpsStore((state) => state.applyMutationDelta);
  const [careerForm, setCareerForm] = useState<CareerPropertyForm>(() => buildCareerPropertyForm());
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredCareer = career.filter((item) => {
    const keyword = query.trim().toLowerCase();
    if (selectedCategory && item.category !== selectedCategory) return false;
    if (!keyword) return true;
    return [item.organization, item.role, item.description, item.category].some((value) => value?.toLowerCase().includes(keyword));
  });

  return (
    <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-3">
        <section className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-primary">커리어 만들기</p>
          <h1 className="mt-2 font-display text-4xl text-foreground">커리어 타임라인</h1>
        </section>
        <PropertyPanel
          definitions={CAREER_PROPERTY_DEFINITIONS}
          form={careerForm}
          groups={CAREER_PROPERTY_GROUPS}
          onChange={(patch) => setCareerForm((current) => ({ ...current, ...patch }))}
          title="새 이력 속성"
        />
        <button
          className="focus-ring rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          disabled={isPending || !careerForm.organization.trim() || !careerForm.role.trim()}
          onClick={() => {
            startTransition(async () => {
              try {
                const payload = careerPropertyPayload(careerForm);
                await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
                  "/api/life-ops/career",
                  payload,
                  applyMutationDelta,
                );
                setCareerForm({ ...buildCareerPropertyForm(), startDate: careerForm.startDate });
                toast.success("커리어 이력을 추가했습니다.");
              } catch (error) {
                toast.error("커리어 추가에 실패했습니다.", {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
          type="button"
        >
          이력 추가
        </button>
      </div>

      <div className="space-y-4">
        <FilterBar
          filters={[
            {
              kind: "select",
              key: "category",
              label: "분류",
              options: CAREER_CATEGORY_OPTIONS,
            },
          ]}
          onChange={(state) => {
            setQuery(state.q);
            setSelectedCategory((state.filters.category as string | null) ?? null);
          }}
          searchPlaceholder="조직, 역할, 설명 검색"
        />
        {filteredCareer.map((item) => (
          <CareerNode
            item={item}
            key={item.id}
            onDelete={() => {
              startTransition(async () => {
                try {
                  await postDeltaMutation<{ delta: LifeOpsMutationDelta }, LifeOpsMutationDelta>(
                    `/api/life-ops/career/${item.id}/delete`,
                    undefined,
                    applyMutationDelta,
                  );
                } catch (error) {
                  toast.error("커리어 삭제에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
          />
        ))}
      </div>
    </section>
  );
}
