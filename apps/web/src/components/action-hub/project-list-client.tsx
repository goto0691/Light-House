"use client";

import { useState } from "react";

import { ProjectHeader } from "@/components/action-hub/project-header";
import { ProjectPropertiesPanel } from "@/components/action-hub/project-properties-panel";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskDataGrid } from "@/components/action-hub/task-data-grid";
import { FilterBar } from "@/components/shared/filter-bar";
import type { ProjectMock, TaskMock } from "@/lib/mock/action-hub";
import { TASK_STATUS_OPTIONS } from "@/lib/properties/task";

type ProjectListClientProps = {
  project: ProjectMock;
  tasks: TaskMock[];
};

export function ProjectListClient({ project, tasks }: ProjectListClientProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

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
          <span className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-xs tracking-[0.08em] text-muted-foreground">
            {visibleTasks.length}개 행
          </span>
        }
        searchPlaceholder="리스트에서 태스크 검색"
      />
      {visibleTasks.length ? (
        <TaskDataGrid projectId={project.id} tasks={visibleTasks} />
      ) : (
        <EmptyState description="검색어나 상태 필터를 다시 조정하면 리스트가 다시 떠오릅니다." illustration="task" title="이 조건에 맞는 태스크가 없습니다" />
      )}
    </section>
  );
}
