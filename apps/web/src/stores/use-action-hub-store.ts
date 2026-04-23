"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ulid } from "ulidx";

import {
  PENDING_CAPTURES,
  PROJECTS_MOCK,
  TASKS_MOCK,
  type PendingCaptureMock,
  type ProjectMock,
  type TaskMock,
  type TaskStatus,
} from "@/lib/mock/action-hub";

type CaptureResult = {
  status: "routed" | "pending";
  suggested: {
    domain: string;
    fields: Record<string, string | number | null>;
    confidence: number;
  };
};

type ActionHubState = {
  projects: ProjectMock[];
  tasks: TaskMock[];
  pendingCaptures: PendingCaptureMock[];
  replaceSnapshot: (snapshot: Pick<ActionHubState, "projects" | "tasks" | "pendingCaptures">) => void;
  ingestCapture: (text: string, result: CaptureResult) => { taskId?: string };
  dismissCapture: (id: string) => void;
  routeInboxTaskToProject: (taskId: string, projectId: string) => void;
  cycleTaskStatus: (taskId: string) => void;
  updateTaskContent: (taskId: string, content: string) => void;
  updateTaskTitle: (taskId: string, title: string) => void;
};

const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "done", "blocked"];

export const useActionHubStore = create<ActionHubState>()(
  persist(
    (set) => ({
      projects: PROJECTS_MOCK,
      tasks: TASKS_MOCK,
      pendingCaptures: PENDING_CAPTURES,
      replaceSnapshot: (snapshot) =>
        set(() => ({
          projects: snapshot.projects,
          tasks: snapshot.tasks,
          pendingCaptures: snapshot.pendingCaptures,
        })),
      ingestCapture: (text, result) => {
        if (result.status === "routed" && result.suggested.domain === "task") {
          const taskId = ulid();
          set((state) => ({
            tasks: [
              {
                id: taskId,
                projectId: null,
                title: String(result.suggested.fields.title ?? text),
                kind: "research",
                status: "todo",
                priority: "P2",
                brainEnergy: "normal",
                dueAt: typeof result.suggested.fields.dueAt === "string" ? result.suggested.fields.dueAt : undefined,
                checklist: { total: 1, completed: 0 },
                linkedPeople: [],
                linkedZettels: [],
                content: text,
              },
              ...state.tasks,
            ],
          }));
          return { taskId };
        }

        const captureId = ulid();
        set((state) => ({
          pendingCaptures: [
            {
              id: captureId,
              text,
              suggestedDomain: result.suggested.domain,
              confidence: result.suggested.confidence,
            },
            ...state.pendingCaptures,
          ],
        }));

        return {};
      },
      dismissCapture: (id) =>
        set((state) => ({
          pendingCaptures: state.pendingCaptures.filter((item) => item.id !== id),
        })),
      routeInboxTaskToProject: (taskId, projectId) =>
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, projectId } : task)),
        })),
      cycleTaskStatus: (taskId) =>
        set((state) => ({
          tasks: state.tasks.map((task) => {
            if (task.id !== taskId) return task;
            const currentIndex = STATUS_ORDER.indexOf(task.status);
            return { ...task, status: STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length] };
          }),
        })),
      updateTaskContent: (taskId, content) =>
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, content } : task)),
        })),
      updateTaskTitle: (taskId, title) =>
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, title } : task)),
        })),
    }),
    {
      name: "light-house-action-hub",
      partialize: (state) => ({
        projects: state.projects,
        tasks: state.tasks,
        pendingCaptures: state.pendingCaptures,
      }),
    },
  ),
);
