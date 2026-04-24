"use client";

import { CalendarDays, LayoutGrid, ListTodo, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Tag } from "@/components/shared/tag";
import { ViewSwitcher } from "@/components/shared/view-switcher";
import { PageHeader } from "@/components/shared/page-layout";
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
    <PageHeader
      eyebrow="Action Hub"
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-2xl shadow-[var(--shadow-sm)]">
            {project.icon}
          </span>
          <span>{project.title}</span>
        </span>
      }
      description={project.recentActivity}
      meta={
        <>
          <Tag value={project.category} variant="custom" />
          <Tag value={project.kind} variant="neutral" />
          <span className="rounded-md border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Due {project.dueLabel}
          </span>
          <span className="rounded-md border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-primary">
            {project.progress}% complete
          </span>
        </>
      }
      actions={
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
      }
    />
  );
}
