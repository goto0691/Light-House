"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ulid } from "ulidx";

import {
  PENDING_CAPTURES,
  PROJECTS_MOCK,
  TASKS_MOCK,
  type ActionHubReference,
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

export type ActionHubTaskDelta = {
  project?: ProjectMock | null;
  task: TaskMock;
};

export type ActionHubProjectDelta = {
  project: ProjectMock;
};

export type ActionHubCaptureDelta = {
  pendingCapture?: PendingCaptureMock;
  pendingCaptureId?: string;
  project?: ProjectMock | null;
  referenceZettel?: ActionHubReference;
  routedEntity?: {
    id: string;
    type: "task" | "zettel";
  };
  task?: TaskMock;
};

type ActionHubState = {
  projects: ProjectMock[];
  tasks: TaskMock[];
  pendingCaptures: PendingCaptureMock[];
  referencePeople: ActionHubReference[];
  referenceZettels: ActionHubReference[];
  replaceSnapshot: (snapshot: Pick<ActionHubState, "projects" | "tasks" | "pendingCaptures" | "referencePeople" | "referenceZettels">) => void;
  applyCaptureDelta: (delta: ActionHubCaptureDelta) => void;
  applyProjectDelta: (delta: ActionHubProjectDelta) => void;
  applyTaskDelta: (delta: ActionHubTaskDelta) => void;
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
      referencePeople: [],
      referenceZettels: [],
      replaceSnapshot: (snapshot) =>
        set(() => ({
          projects: snapshot.projects,
          tasks: snapshot.tasks,
          pendingCaptures: snapshot.pendingCaptures,
          referencePeople: snapshot.referencePeople,
          referenceZettels: snapshot.referenceZettels,
        })),
      applyCaptureDelta: (delta) =>
        set((state) => {
          const projects = delta.project
            ? state.projects.some((project) => project.id === delta.project!.id)
              ? state.projects.map((project) => (project.id === delta.project!.id ? delta.project! : project))
              : [...state.projects, delta.project]
            : state.projects;
          const tasks = delta.task
            ? state.tasks.some((task) => task.id === delta.task!.id)
              ? state.tasks.map((task) => (task.id === delta.task!.id ? delta.task! : task))
              : [delta.task, ...state.tasks]
            : state.tasks;
          const referenceZettels = delta.referenceZettel
            ? state.referenceZettels.some((zettel) => zettel.id === delta.referenceZettel!.id)
              ? state.referenceZettels.map((zettel) => (zettel.id === delta.referenceZettel!.id ? delta.referenceZettel! : zettel))
              : [delta.referenceZettel, ...state.referenceZettels]
            : state.referenceZettels;
          const pendingCaptures = delta.pendingCapture
            ? state.pendingCaptures.some((capture) => capture.id === delta.pendingCapture!.id)
              ? state.pendingCaptures.map((capture) => (capture.id === delta.pendingCapture!.id ? delta.pendingCapture! : capture))
              : [delta.pendingCapture, ...state.pendingCaptures]
            : state.pendingCaptures;

          return {
            pendingCaptures: delta.pendingCaptureId ? pendingCaptures.filter((capture) => capture.id !== delta.pendingCaptureId) : pendingCaptures,
            projects,
            referenceZettels,
            tasks,
          };
        }),
      applyProjectDelta: (delta) =>
        set((state) => ({
          projects: state.projects.some((project) => project.id === delta.project.id)
            ? state.projects.map((project) => (project.id === delta.project.id ? delta.project : project))
            : [...state.projects, delta.project],
        })),
      applyTaskDelta: (delta) =>
        set((state) => {
          const projects = delta.project
            ? state.projects.some((project) => project.id === delta.project!.id)
              ? state.projects.map((project) => (project.id === delta.project!.id ? delta.project! : project))
              : [...state.projects, delta.project]
            : state.projects;
          const tasks = state.tasks.some((task) => task.id === delta.task.id)
            ? state.tasks.map((task) => (task.id === delta.task.id ? delta.task : task))
            : [delta.task, ...state.tasks];

          return { projects, tasks };
        }),
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
                checklistItems: [{ id: ulid(), content: "프로젝트 라우팅", completed: false }],
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
        referencePeople: state.referencePeople,
        referenceZettels: state.referenceZettels,
      }),
    },
  ),
);
