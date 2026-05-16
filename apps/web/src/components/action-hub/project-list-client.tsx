"use client";

import { useState } from "react";

import { ProjectHeader } from "@/components/action-hub/project-header";
import { ProjectPropertiesPanel } from "@/components/action-hub/project-properties-panel";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskDataGrid } from "@/components/action-hub/task-data-grid";
import { FilterBar } from "@/components/shared/filter-bar";
import type { ProjectMock, TaskMock } from "@/lib/mock/action-hub";
import { TASK_STATUS_OPTIONS } from "@/lib/properties/task";
import { useShellStore } from "@/stores/use-shell-store";

type ProjectListClientProps = {
  project: ProjectMock;
  tasks: TaskMock[];
};

export function ProjectListClient({ project, tasks }: ProjectListClientProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const openQuickCapture = useShellStore((state) => state.openQuickCapture);

  const visibleTasks = tasks.filter((task) => {
    if (statusFilter && task.status !== statusFilter) return false;
    if (query && !`${task.title} ${task.content}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="space-y-4">
      <ProjectHeader currentView="list" project={project} />
      <ProjectPropertiesPanel project={project} />
      <FilterBar
        filters={[
          {
            kind: "select",
            key: "status",
            label: "상태",
            options: TASK_STATUS_OPTIONS,
          },
        ]}
        onChange={(state) => {
          setQuery(state.q);
          setStatusFilter(typeof state.filters.status === "string" ? state.filters.status : "");
        }}
        rightSlot={
          <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs tracking-[0.08em] text-muted-foreground">
            {visibleTasks.length}개 행
          </span>
        }
        searchPlaceholder="리스트에서 작업 검색"
      />
      {visibleTasks.length ? (
        <TaskDataGrid projectId={project.id} tasks={visibleTasks} />
      ) : (
        <EmptyState
          cta={{
            label: "빠른 입력",
            onClick: () => openQuickCapture({ domain: "action-hub", label: project.title, projectId: project.id }),
          }}
          description="검색어나 상태 필터를 다시 조정하거나, 이 프로젝트에 새 작업을 추가해보세요."
          illustration="task"
          title="이 조건에 맞는 작업이 없습니다"
        />
      )}
    </section>
  );
}
