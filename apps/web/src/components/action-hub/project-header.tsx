"use client";

import { CalendarDays, LayoutGrid, ListTodo, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Tag } from "@/components/shared/tag";
import { ViewSwitcher } from "@/components/shared/view-switcher";
import type { ProjectMock } from "@/lib/mock/action-hub";

type ProjectHeaderProps = {
  project: ProjectMock;
  currentView: "kanban" | "calendar" | "list";
};

const VIEW_ICON: Record<ProjectHeaderProps["currentView"], LucideIcon> = {
  kanban: LayoutGrid,
  calendar: CalendarDays,
  list: ListTodo,
};

export function ProjectHeader({ project, currentView }: ProjectHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-5 rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-[var(--shadow-md)] xl:flex-row xl:items-end xl:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Action Hub</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-2xl shadow-[var(--shadow-sm)]">
            {project.icon}
          </span>
          <div>
            <h1 className="font-display text-3xl text-foreground">{project.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{project.recentActivity}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tag value={project.category} variant="custom" />
          <Tag value={project.kind} variant="neutral" />
          <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Due {project.dueLabel}
          </span>
          <span className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-primary">
            {project.progress}% complete
          </span>
        </div>
      </div>

      <ViewSwitcher
        current={currentView}
        onSwitch={(key) => {
          const nextPath = key === "kanban" ? `/action-hub/${project.id}` : `/action-hub/${project.id}/${key}`;
          router.push(nextPath);
        }}
        views={[
          { key: "kanban", label: "Kanban", icon: VIEW_ICON.kanban },
          { key: "calendar", label: "Calendar", icon: VIEW_ICON.calendar },
          { key: "list", label: "List", icon: VIEW_ICON.list },
        ]}
      />
    </div>
  );
}
