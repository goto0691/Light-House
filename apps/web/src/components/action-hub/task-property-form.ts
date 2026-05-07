import type { TaskMock } from "@/lib/mock/action-hub";

export type TaskPropertyForm = {
  title: string;
  kind: TaskMock["kind"];
  status: TaskMock["status"];
  priority: TaskMock["priority"];
  brainEnergy: TaskMock["brainEnergy"];
  dueAt: string;
  content: string;
};

export function buildTaskPropertyForm(task: TaskMock): TaskPropertyForm {
  return {
    title: task.title,
    kind: task.kind,
    status: task.status,
    priority: task.priority,
    brainEnergy: task.brainEnergy,
    dueAt: task.dueAt?.slice(0, 10) ?? "",
    content: task.content,
  };
}

export function taskPropertyPayload(form: TaskPropertyForm) {
  return {
    title: form.title,
    kind: form.kind,
    status: form.status,
    priority: form.priority,
    brainEnergy: form.brainEnergy,
    dueAt: form.dueAt || null,
    content: form.content,
  };
}
