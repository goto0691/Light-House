import type { ProjectMock } from "@/lib/mock/action-hub";

export type ProjectPropertyForm = {
  title: string;
  kind: ProjectMock["kind"];
  status: ProjectMock["status"];
  category: string;
  description: string;
  icon: string;
  color: string;
  targetDate: string;
};

export function buildProjectPropertyForm(project: ProjectMock): ProjectPropertyForm {
  return {
    title: project.title,
    kind: project.kind,
    status: project.status,
    category: project.category,
    description: project.description ?? "",
    icon: project.icon,
    color: project.color,
    targetDate: project.targetDate?.slice(0, 10) ?? "",
  };
}

export function projectPropertyPayload(form: ProjectPropertyForm) {
  return {
    title: form.title,
    kind: form.kind,
    status: form.status,
    category: form.category,
    description: form.description,
    icon: form.icon,
    color: form.color,
    targetDate: form.targetDate || null,
  };
}
