"use client";

import { useState } from "react";

import { ProjectHeader } from "@/components/action-hub/project-header";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskCalendar } from "@/components/action-hub/task-calendar";
import { FilterBar } from "@/components/shared/filter-bar";
import type { ProjectMock, TaskMock } from "@/lib/mock/action-hub";

type ProjectCalendarClientProps = {
  project: ProjectMock;
  tasks: TaskMock[];
};

export function ProjectCalendarClient({ project, tasks }: ProjectCalendarClientProps) {
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");

  const visibleTasks = tasks.filter((task) => {
    if (priorityFilter && task.priority !== priorityFilter) return false;
    if (query && !`${task.title} ${task.content}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="space-y-4">
      <ProjectHeader currentView="calendar" project={project} />
      <FilterBar
        filters={[
          {
            kind: "select",
            key: "priority",
            label: "Priority",
            options: [
              { value: "P1", label: "P1" },
              { value: "P2", label: "P2" },
              { value: "P3", label: "P3" },
            ],
          },
        ]}
        onChange={(state) => {
          setQuery(state.q);
          setPriorityFilter(typeof state.filters.priority === "string" ? state.filters.priority : "");
        }}
        rightSlot={
          <span className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {visibleTasks.length} due dates
          </span>
        }
        searchPlaceholder="캘린더 태스크 검색"
      />
      {visibleTasks.length ? (
        <TaskCalendar projectId={project.id} tasks={visibleTasks} />
      ) : (
        <EmptyState description="우선순위 필터를 풀거나 마감일이 있는 태스크를 추가해보세요." illustration="task" title="캘린더에 놓일 일정이 아직 없습니다" />
      )}
    </section>
  );
}
