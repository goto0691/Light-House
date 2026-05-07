"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { KanbanBoard } from "@/components/action-hub/kanban-board";
import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ProjectHeader } from "@/components/action-hub/project-header";
import { ProjectPropertiesPanel } from "@/components/action-hub/project-properties-panel";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { TaskCard } from "@/components/action-hub/task-card";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { useActionHubStore } from "@/stores/use-action-hub-store";
import type { ProjectMock, TaskMock } from "@/lib/mock/action-hub";
import { TASK_BRAIN_ENERGY_OPTIONS, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from "@/lib/properties/task";

export function KanbanClient({ project }: { project: ProjectMock }) {
  const [isPending, startTransition] = useTransition();
  const allTasks = useActionHubStore((state) => state.tasks);
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [energyFilter, setEnergyFilter] = useState<string[]>([]);

  const projectTasks = useMemo(() => allTasks.filter((task) => task.projectId === project.id), [allTasks, project.id]);
  const visibleTasks = projectTasks.filter((task) => {
    if (statusFilter && task.status !== statusFilter) return false;
    if (priorityFilter.length && !priorityFilter.includes(task.priority)) return false;
    if (energyFilter.length && !energyFilter.includes(task.brainEnergy)) return false;
    if (query && !`${task.title} ${task.content}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  function renderTask(task: TaskMock) {
    return (
      <div key={task.id}>
        <TaskCard projectId={project.id} task={task} />
        <div className="mt-2 flex justify-end">
          <button
            className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] tracking-[0.08em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                    `/api/action-hub/tasks/${task.id}/cycle-status`,
                    undefined,
                    replaceSnapshot,
                  );
                  toast.success("태스크 상태를 다음 단계로 이동했습니다.");
                } catch (error) {
                  toast.error("상태 이동에 실패했습니다.", {
                    description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  });
                }
              });
            }}
            type="button"
          >
            상태 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <PageLayout>
      <ProjectHeader currentView="kanban" project={project} />
      <ProjectPropertiesPanel project={project} />
      <PageToolbar>
        <FilterBar
          filters={[
            {
              kind: "select",
              key: "status",
              label: "상태",
              options: TASK_STATUS_OPTIONS,
            },
            {
              kind: "multi",
              key: "priority",
              label: "우선순위",
              options: TASK_PRIORITY_OPTIONS,
            },
            {
              kind: "multi",
              key: "energy",
              label: "에너지",
              options: TASK_BRAIN_ENERGY_OPTIONS,
            },
          ]}
          onChange={(state) => {
            setQuery(state.q);
            setStatusFilter(typeof state.filters.status === "string" ? state.filters.status : "");
            setPriorityFilter(Array.isArray(state.filters.priority) ? state.filters.priority : []);
            setEnergyFilter(Array.isArray(state.filters.energy) ? state.filters.energy : []);
          }}
          rightSlot={
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs tracking-[0.08em] text-muted-foreground">
              {visibleTasks.length}개 작업
            </span>
          }
          searchPlaceholder="태스크 제목, 메모, 연결 키워드 검색"
        />
      </PageToolbar>
      <KanbanBoard
        renderTask={renderTask}
        tasks={visibleTasks}
      />
      <div className="mt-4">
        <ContextBundlePanel
          density="compact"
          enableAttach
          entityId={project.id}
          entityType="project"
          mainSlot={() => (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">
              이 프로젝트와 연결된 태스크, 사람, Zettel, 날짜 기록을 한 자리에서 탐색합니다.
            </div>
          )}
          railDefaultLens="overview"
        />
      </div>
      {!visibleTasks.length ? (
        <EmptyState
          cta={{
            label: "빠른 입력",
            hotkey: "Cmd+Shift+N",
            onClick: () => window.dispatchEvent(new CustomEvent("light-house:open-quick-capture")),
          }}
          description="필터를 넓히거나 빠른 입력으로 새 태스크를 던져보세요."
          illustration="task"
          title="이 보드에는 아직 움직이는 카드가 없어요"
        />
      ) : null}
    </PageLayout>
  );
}
