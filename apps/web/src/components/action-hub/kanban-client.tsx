"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { KanbanBoard } from "@/components/action-hub/kanban-board";
import { ProjectHeader } from "@/components/action-hub/project-header";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { TaskCard } from "@/components/action-hub/task-card";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { useActionHubStore } from "@/stores/use-action-hub-store";
import type { ProjectMock, TaskMock } from "@/lib/mock/action-hub";

export function KanbanClient({ project }: { project: ProjectMock }) {
  const [isPending, startTransition] = useTransition();
  const tasks = useActionHubStore((state) => state.tasks.filter((task) => task.projectId === project.id));
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [energyFilter, setEnergyFilter] = useState<string[]>([]);

  const visibleTasks = tasks.filter((task) => {
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
            className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
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
      <PageToolbar>
        <FilterBar
          filters={[
            {
              kind: "select",
              key: "status",
              label: "Status",
              options: [
                { value: "todo", label: "Backlog" },
                { value: "in_progress", label: "In Progress" },
                { value: "review", label: "Review" },
                { value: "done", label: "Done" },
                { value: "blocked", label: "Blocked" },
              ],
            },
            {
              kind: "multi",
              key: "priority",
              label: "Priority",
              options: [
                { value: "P1", label: "P1" },
                { value: "P2", label: "P2" },
                { value: "P3", label: "P3" },
              ],
            },
            {
              kind: "multi",
              key: "energy",
              label: "Energy",
              options: [
                { value: "hyper_focus", label: "Hyper Focus" },
                { value: "normal", label: "Normal" },
                { value: "routine", label: "Routine" },
              ],
            },
          ]}
          onChange={(state) => {
            setQuery(state.q);
            setStatusFilter(typeof state.filters.status === "string" ? state.filters.status : "");
            setPriorityFilter(Array.isArray(state.filters.priority) ? state.filters.priority : []);
            setEnergyFilter(Array.isArray(state.filters.energy) ? state.filters.energy : []);
          }}
          rightSlot={
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {visibleTasks.length} tasks
            </span>
          }
          searchPlaceholder="태스크 제목, 메모, 연결 키워드 검색"
        />
      </PageToolbar>
      <KanbanBoard
        tasks={visibleTasks}
        renderTask={renderTask}
      />
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
