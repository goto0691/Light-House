"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { HabitConfigForm } from "@/components/life-ops/habit-config-form";
import { HabitPropertiesPanel } from "@/components/life-ops/habit-properties-panel";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

export function HabitsClient() {
  const [isPending, startTransition] = useTransition();
  const habits = useLifeOpsStore((state) => state.habits);
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const [query, setQuery] = useState("");
  const visibleHabits = habits.filter((habit) => {
    if (query && !`${habit.title} ${habit.description} ${habit.schedule}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs text-primary">Life Ops · 습관</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">활성 습관 관리</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">활성 습관, 스케줄, 설명을 한 번에 보고 켜고 끄는 설정 레이어입니다.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/10 px-4 py-2 text-xs text-muted-foreground">{visibleHabits.length}개</span>
        </div>
      </GlassCard>

      <FilterBar filters={[]} onChange={(state) => setQuery(state.q)} searchPlaceholder="습관 제목, 설명, 스케줄 검색" />

      <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <HabitConfigForm
          disabled={isPending}
          onSubmit={({ title, description, icon, schedule }) => {
            startTransition(async () => {
              try {
                await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                  "/api/life-ops/habits",
                  { title, description, icon, schedule },
                  replaceSnapshot,
                );
                toast.success("습관을 추가했습니다.");
              } catch (error) {
                toast.error("습관 추가에 실패했습니다.", {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
        />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleHabits.map((habit) => (
            <div className="space-y-3" key={habit.id}>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{habit.icon}</span>
                  <button
                    className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:opacity-60"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/life-ops/habits/${habit.id}/toggle-active`,
                            undefined,
                            replaceSnapshot,
                          );
                        } catch (error) {
                          toast.error("습관 상태 변경에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    {habit.isActive ? "비활성화" : "활성화"}
                  </button>
                </div>
                <h2 className="mt-3 text-lg font-medium text-foreground">{habit.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{habit.description || "설명이 없습니다."}</p>
                <p className="mt-3 text-xs text-primary">{habit.schedule}</p>
              </div>
              <details className="rounded-lg border border-white/10 bg-white/5 p-3">
                <summary className="cursor-pointer list-none text-xs text-muted-foreground">속성 편집</summary>
                <div className="mt-3">
                  <HabitPropertiesPanel habit={habit} />
                </div>
              </details>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
