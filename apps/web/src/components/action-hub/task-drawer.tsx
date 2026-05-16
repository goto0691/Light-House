"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { buildTaskPropertyForm, taskPropertyPayload, type TaskPropertyForm } from "@/components/action-hub/task-property-form";
import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import type { TaskMock } from "@/lib/mock/action-hub";
import {
  TASK_BRAIN_ENERGY_OPTIONS,
  TASK_KIND_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  TASK_PROPERTY_DEFINITIONS,
  TASK_PROPERTY_GROUPS,
  TASK_STATUS_OPTIONS,
} from "@/lib/properties/task";
import { optionLabel } from "@/lib/properties/types";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { type ActionHubTaskDelta, useActionHubStore } from "@/stores/use-action-hub-store";

export function TaskDrawer({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const task = useActionHubStore((state) => state.tasks.find((item) => item.id === id));
  const applyTaskDelta = useActionHubStore((state) => state.applyTaskDelta);
  const [form, setForm] = useState<TaskPropertyForm | null>(task ? buildTaskPropertyForm(task) : null);

  useEffect(() => {
    setForm(task ? buildTaskPropertyForm(task) : null);
  }, [task]);

  if (!task || !form) {
    return (
      <section className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
        작업 데이터를 찾지 못했습니다.
      </section>
    );
  }

  const saveProperties = () => {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${task.id}/properties`,
          taskPropertyPayload(form),
          applyTaskDelta,
        );
        toast.success("작업 속성을 저장했습니다.");
      } catch (error) {
        toast.error("작업 속성 저장에 실패했습니다.", {
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
      entityType="task"
      mainSlot={() => (
        <div className="space-y-4">
          <section className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs tracking-[0.08em] text-primary">{optionLabel(TASK_KIND_OPTIONS, form.kind, form.kind)}</p>
            <h3 className="mt-2 text-2xl font-semibold text-foreground">{form.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{form.content}</p>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <Metric label="상태" value={optionLabel(TASK_STATUS_OPTIONS, form.status, form.status)} />
            <Metric label="우선순위" value={optionLabel(TASK_PRIORITY_OPTIONS, form.priority, form.priority)} />
            <Metric label="에너지" value={optionLabel(TASK_BRAIN_ENERGY_OPTIONS, form.brainEnergy, form.brainEnergy)} />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <div>
              <p className="text-xs tracking-[0.08em] text-primary">기준 속성</p>
              <p className="mt-1 text-sm text-muted-foreground">작업의 기준 필드를 한 곳에서 조정합니다.</p>
            </div>
            <button
              className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              disabled={isPending}
              onClick={saveProperties}
              type="button"
            >
              {isPending ? "저장 중..." : "속성 저장"}
            </button>
          </div>

          <PropertyPanel
            definitions={TASK_PROPERTY_DEFINITIONS}
            form={form}
            groups={TASK_PROPERTY_GROUPS}
            onChange={(patch) => setForm({ ...form, ...patch })}
            title="작업 속성"
          />

          <section className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs tracking-[0.08em] text-primary">체크리스트</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {task.checklist.completed} / {task.checklist.total} 완료
            </p>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs tracking-[0.08em] text-primary">연결</p>
            <p className="mt-3 text-sm text-muted-foreground">사람: {task.linkedPeople.join(", ") || "없음"}</p>
            <p className="mt-1 text-sm text-muted-foreground">지식: {task.linkedZettels.join(", ") || "없음"}</p>
          </section>
        </div>
      )}
      railDefaultLens="overview"
    />
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-lg font-medium text-foreground">{value}</p>
    </div>
  );
}
