"use client";

import { CalendarDays, LayoutGrid, ListTodo, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Tag } from "@/components/shared/tag";
import { ViewSwitcher } from "@/components/shared/view-switcher";
import { PageHeader } from "@/components/shared/page-layout";
import type { ProjectMock } from "@/lib/mock/action-hub";
import { PROJECT_KIND_OPTIONS, PROJECT_STATUS_OPTIONS } from "@/lib/properties/project";
import { optionLabel } from "@/lib/properties/types";
import { useActionHubStore } from "@/stores/use-action-hub-store";

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
  const activeProject = useActionHubStore((state) => state.projects.find((item) => item.id === project.id)) ?? project;

  return (
    <PageHeader
      eyebrow="작업실"
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md border border-white/10 bg-black/20 text-2xl shadow-[var(--shadow-sm)]">
            {activeProject.icon}
          </span>
          <span>{activeProject.title}</span>
        </span>
      }
      description={activeProject.description || activeProject.recentActivity}
      meta={
        <>
          <Tag value={activeProject.category} variant="custom" />
          <Tag value={optionLabel(PROJECT_KIND_OPTIONS, activeProject.kind, activeProject.kind)} variant="neutral" />
          <Tag value={optionLabel(PROJECT_STATUS_OPTIONS, activeProject.status, activeProject.status)} variant="status" />
          <span className="rounded-md border border-white/10 bg-black/10 px-3 py-1 text-[11px] tracking-[0.08em] text-muted-foreground">
            마감 {activeProject.dueLabel}
          </span>
          <span className="rounded-md border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] tracking-[0.08em] text-primary">
            {activeProject.progress}% 완료
          </span>
        </>
      }
      actions={
        <ViewSwitcher
          current={currentView}
          onSwitch={(key) => {
            const nextPath = key === "kanban" ? `/action-hub/${activeProject.id}` : `/action-hub/${activeProject.id}/${key}`;
            router.push(nextPath, { scroll: false });
          }}
          views={[
            { key: "kanban", label: "칸반", icon: VIEW_ICON.kanban },
            { key: "calendar", label: "캘린더", icon: VIEW_ICON.calendar },
            { key: "list", label: "목록", icon: VIEW_ICON.list },
          ]}
        />
      }
    />
  );
}
