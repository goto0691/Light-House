"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { buildTaskPropertyForm, taskPropertyPayload, type TaskPropertyForm } from "@/components/action-hub/task-property-form";
import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownView } from "@/components/shared/markdown-view";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import { ZenEditor } from "@/components/shared/zen-editor";
import type { ActionHubReference, ProjectMock, TaskMock } from "@/lib/mock/action-hub";
import { TASK_PROPERTY_DEFINITIONS, TASK_PROPERTY_GROUPS } from "@/lib/properties/task";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { type ActionHubTaskDelta, useActionHubStore } from "@/stores/use-action-hub-store";

const WORKSPACE_TASK_PROPERTY_DEFINITIONS = TASK_PROPERTY_DEFINITIONS.filter((definition) => !["title", "content"].includes(definition.field));

const SIDE_PANEL_OPTIONS = [
  ["summary", "요약"],
  ["checklist", "체크"],
  ["links", "연결"],
  ["context", "맥락"],
] as const;

type TaskSidePanel = (typeof SIDE_PANEL_OPTIONS)[number][0];

export function TaskWorkspaceClient({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [isPending, startTransition] = useTransition();
  const project = useActionHubStore((state) => state.projects.find((item) => item.id === projectId));
  const task = useActionHubStore((state) => state.tasks.find((item) => item.id === taskId));
  const referencePeople = useActionHubStore((state) => state.referencePeople);
  const referenceZettels = useActionHubStore((state) => state.referenceZettels);
  const applyTaskDelta = useActionHubStore((state) => state.applyTaskDelta);
  const [taskForm, setTaskForm] = useState<TaskPropertyForm | null>(task ? buildTaskPropertyForm(task) : null);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [personId, setPersonId] = useState("");
  const [zettelId, setZettelId] = useState("");
  const [sidePanel, setSidePanel] = useState<TaskSidePanel>("summary");
  const [isEditing, setIsEditing] = useState(false);
  const [contextRefreshKey, setContextRefreshKey] = useState(0);

  const attachablePeople = useMemo(() => referencePeople.filter((item) => !task?.linkedPeople.includes(item.title)), [referencePeople, task]);
  const attachableZettels = useMemo(() => referenceZettels.filter((item) => !task?.linkedZettels.includes(item.title)), [referenceZettels, task]);

  useEffect(() => {
    setTaskForm(task ? buildTaskPropertyForm(task) : null);
  }, [task]);

  useEffect(() => {
    setChecklistDraft("");
    setIsEditing(false);
    setSidePanel("summary");
  }, [task?.id]);

  useEffect(() => {
    if (!attachablePeople.length) {
      if (personId) setPersonId("");
      return;
    }
    if (!attachablePeople.some((person) => person.id === personId)) setPersonId(attachablePeople[0].id);
  }, [attachablePeople, personId]);

  useEffect(() => {
    if (!attachableZettels.length) {
      if (zettelId) setZettelId("");
      return;
    }
    if (!attachableZettels.some((zettel) => zettel.id === zettelId)) setZettelId(attachableZettels[0].id);
  }, [attachableZettels, zettelId]);

  if (!project || !task || !taskForm) {
    return (
      <GlassCard>
        <p className="text-sm text-muted-foreground">작업을 찾지 못했습니다.</p>
      </GlassCard>
    );
  }

  const activeTask = task;

  function beginEdit() {
    setTaskForm(buildTaskPropertyForm(activeTask));
    setSidePanel("summary");
    setIsEditing(true);
  }

  function cancelEdit() {
    setTaskForm(buildTaskPropertyForm(activeTask));
    setIsEditing(false);
  }

  function saveTaskProperties() {
    if (!taskForm) return;
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${activeTask.id}/properties`,
          taskPropertyPayload(taskForm),
          applyTaskDelta,
        );
        setContextRefreshKey((value) => value + 1);
        setIsEditing(false);
        toast.success("작업을 저장했습니다.");
      } catch (error) {
        toast.error("작업 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function cycleStatus() {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${activeTask.id}/cycle-status`,
          undefined,
          applyTaskDelta,
        );
        toast.success("상태를 다음 단계로 변경했습니다.");
      } catch (error) {
        toast.error("상태 변경에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function toggleChecklistItem(itemId: string) {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/checklists/${itemId}/toggle`,
          undefined,
          applyTaskDelta,
        );
      } catch (error) {
        toast.error("체크리스트 상태 변경에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function deleteChecklistItem(itemId: string) {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/checklists/${itemId}/delete`,
          undefined,
          applyTaskDelta,
        );
      } catch (error) {
        toast.error("체크리스트 삭제에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function addChecklistItem() {
    const content = checklistDraft.trim();
    if (!content) return;
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${activeTask.id}/checklists`,
          { content },
          applyTaskDelta,
        );
        setChecklistDraft("");
      } catch (error) {
        toast.error("체크리스트 추가에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function attachPerson() {
    if (!personId) return;
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${activeTask.id}/people`,
          { personId },
          applyTaskDelta,
        );
        setContextRefreshKey((value) => value + 1);
      } catch (error) {
        toast.error("인물 연결에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function detachPerson(personName: string) {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${activeTask.id}/people`,
          { mode: "detach", personName },
          applyTaskDelta,
        );
        setContextRefreshKey((value) => value + 1);
      } catch (error) {
        toast.error("인물 연결 해제에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function attachZettel() {
    if (!zettelId) return;
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${activeTask.id}/zettels`,
          { zettelId },
          applyTaskDelta,
        );
        setContextRefreshKey((value) => value + 1);
      } catch (error) {
        toast.error("지식 연결에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function detachZettel(zettelTitle: string) {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubTaskDelta }, ActionHubTaskDelta>(
          `/api/action-hub/tasks/${activeTask.id}/zettels`,
          { mode: "detach", zettelTitle },
          applyTaskDelta,
        );
        setContextRefreshKey((value) => value + 1);
      } catch (error) {
        toast.error("지식 연결 해제에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  return (
    <section className="space-y-4">
      <GlassCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs tracking-[0.08em] text-primary">작업 워크스페이스</p>
              <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-muted-foreground">{isEditing ? "편집 모드" : "읽기 모드"}</span>
            </div>
            {isEditing ? (
              <input
                aria-label="작업 제목"
                className="mt-3 w-full rounded-md border border-white/10 bg-black/10 px-3 py-3 text-2xl font-semibold text-foreground outline-none focus:border-primary md:text-3xl"
                onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                value={taskForm.title}
              />
            ) : (
              <h1 className="mt-3 text-3xl font-semibold text-foreground">{taskForm.title}</h1>
            )}
            <p className="mt-3 text-sm text-muted-foreground">{project.title}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" disabled={isPending || isEditing} onClick={cycleStatus} type="button">
              상태 이동
            </button>
            {isEditing ? (
              <>
                <button className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" disabled={isPending} onClick={cancelEdit} type="button">
                  취소
                </button>
                <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={isPending} onClick={saveTaskProperties} type="button">
                  {isPending ? "저장 중..." : "저장"}
                </button>
              </>
            ) : (
              <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={beginEdit} type="button">
                편집
              </button>
            )}
            <Link className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}`} scroll={false}>
              칸반으로 복귀
            </Link>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 xl:order-1">
          {isEditing ? (
            <ZenEditor onChange={(content) => setTaskForm({ ...taskForm, content })} serif={taskForm.kind === "writing"} value={taskForm.content} />
          ) : (
            <GlassCard className="min-h-[520px]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs tracking-[0.08em] text-primary">본문</p>
                <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-muted-foreground">{activeTask.kind === "writing" ? "집필" : "작업"}</span>
              </div>
              <MarkdownView className="mt-4" value={taskForm.content} />
            </GlassCard>
          )}
        </div>

        <aside className="space-y-4 xl:order-2">
          {isEditing ? (
            <PropertyPanel
              definitions={WORKSPACE_TASK_PROPERTY_DEFINITIONS}
              form={taskForm}
              groups={TASK_PROPERTY_GROUPS}
              onChange={(patch) => setTaskForm({ ...taskForm, ...patch })}
              title="편집 속성"
            />
          ) : (
            <>
              <SidePanelTabs active={sidePanel} onChange={setSidePanel} />
              {sidePanel === "summary" ? (
                <>
                  <GlassCard priority="secondary">
                    <PropertySummary definitions={WORKSPACE_TASK_PROPERTY_DEFINITIONS} groups={TASK_PROPERTY_GROUPS} record={activeTask} title="핵심 속성" />
                  </GlassCard>
                  <TaskProgressSummary task={activeTask} />
                </>
              ) : null}
              {sidePanel === "checklist" ? (
                <ChecklistPanel
                  draft={checklistDraft}
                  isPending={isPending}
                  onAdd={addChecklistItem}
                  onDelete={deleteChecklistItem}
                  onDraftChange={setChecklistDraft}
                  onToggle={toggleChecklistItem}
                  task={activeTask}
                />
              ) : null}
              {sidePanel === "links" ? (
                <LinksPanel
                  attachablePeople={attachablePeople}
                  attachableZettels={attachableZettels}
                  isPending={isPending}
                  onAttachPerson={attachPerson}
                  onAttachZettel={attachZettel}
                  onDetachPerson={detachPerson}
                  onDetachZettel={detachZettel}
                  onPersonChange={setPersonId}
                  onZettelChange={setZettelId}
                  personId={personId}
                  task={activeTask}
                  zettelId={zettelId}
                />
              ) : null}
              {sidePanel === "context" ? <TaskContextPanel project={project} refreshKey={contextRefreshKey} task={activeTask} /> : null}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function SidePanelTabs({ active, onChange }: { active: TaskSidePanel; onChange: (panel: TaskSidePanel) => void }) {
  return (
    <div className="flex rounded-lg border border-white/10 bg-black/10 p-1">
      {SIDE_PANEL_OPTIONS.map(([key, label]) => (
        <button
          aria-pressed={active === key}
          className={`focus-ring min-h-10 flex-1 rounded-md px-3 py-2 text-xs font-medium ${
            active === key ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"
          }`}
          key={key}
          onClick={() => onChange(key)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TaskProgressSummary({ task }: { task: TaskMock }) {
  const progress = task.checklist.total ? Math.round((task.checklist.completed / task.checklist.total) * 100) : 0;

  return (
    <GlassCard priority="secondary">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs tracking-[0.08em] text-primary">진행</p>
        <p className="text-sm text-muted-foreground">
          {task.checklist.completed} / {task.checklist.total}
        </p>
      </div>
      <div className="mt-4 rounded-md bg-black/10 p-1">
        <div className="h-2 rounded-sm bg-primary/75" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <MiniMetric label="사람" value={task.linkedPeople.length} />
        <MiniMetric label="지식" value={task.linkedZettels.length} />
      </div>
    </GlassCard>
  );
}

function ChecklistPanel({
  draft,
  isPending,
  onAdd,
  onDelete,
  onDraftChange,
  onToggle,
  task,
}: {
  draft: string;
  isPending: boolean;
  onAdd: () => void;
  onDelete: (itemId: string) => void;
  onDraftChange: (value: string) => void;
  onToggle: (itemId: string) => void;
  task: TaskMock;
}) {
  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs tracking-[0.08em] text-primary">체크리스트</p>
        <p className="text-sm text-muted-foreground">
          {task.checklist.completed} / {task.checklist.total}
        </p>
      </div>
      <div className="mt-3 space-y-2">
        {task.checklistItems.length ? (
          task.checklistItems.map((item) => (
            <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-3" key={item.id}>
              <button
                aria-label={`${item.content} 체크리스트 ${item.completed ? "미완료로 변경" : "완료로 변경"}`}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border ${item.completed ? "border-primary bg-primary" : "border-white/20"}`}
                disabled={isPending}
                onClick={() => onToggle(item.id)}
                type="button"
              />
              <p className={`flex-1 text-sm ${item.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.content}</p>
              <button
                aria-label={`${item.content} 체크리스트 삭제`}
                className="min-h-11 rounded-md border border-white/10 px-3 py-2 text-[11px] text-muted-foreground"
                disabled={isPending}
                onClick={() => onDelete(item.id)}
                type="button"
              >
                삭제
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">아직 체크리스트가 없습니다.</p>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="flex-1 rounded-md border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => onDraftChange(event.target.value)} placeholder="새 체크리스트" value={draft} />
        <button className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground disabled:opacity-50" disabled={isPending || !draft.trim()} onClick={onAdd} type="button">
          추가
        </button>
      </div>
    </GlassCard>
  );
}

function LinksPanel({
  attachablePeople,
  attachableZettels,
  isPending,
  onAttachPerson,
  onAttachZettel,
  onDetachPerson,
  onDetachZettel,
  onPersonChange,
  onZettelChange,
  personId,
  task,
  zettelId,
}: {
  attachablePeople: ActionHubReference[];
  attachableZettels: ActionHubReference[];
  isPending: boolean;
  onAttachPerson: () => void;
  onAttachZettel: () => void;
  onDetachPerson: (personName: string) => void;
  onDetachZettel: (zettelTitle: string) => void;
  onPersonChange: (personId: string) => void;
  onZettelChange: (zettelId: string) => void;
  personId: string;
  task: TaskMock;
  zettelId: string;
}) {
  return (
    <>
      <GlassCard>
        <p className="text-xs tracking-[0.08em] text-primary">연결된 사람</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {task.linkedPeople.length ? (
            task.linkedPeople.map((person) => (
              <button className="rounded-md bg-white/8 px-3 py-1 text-xs text-foreground" disabled={isPending} key={person} onClick={() => onDetachPerson(person)} type="button">
                {person} ×
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">연결된 사람이 없습니다.</p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <select className="flex-1 rounded-md border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => onPersonChange(event.target.value)} value={personId}>
            {attachablePeople.map((person) => (
              <option key={person.id} value={person.id}>
                {person.title}
              </option>
            ))}
          </select>
          <button className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground disabled:opacity-50" disabled={isPending || !personId || !attachablePeople.length} onClick={onAttachPerson} type="button">
            연결
          </button>
        </div>
      </GlassCard>

      <GlassCard>
        <p className="text-xs tracking-[0.08em] text-primary">연결된 지식</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {task.linkedZettels.length ? (
            task.linkedZettels.map((item) => (
              <button className="rounded-md bg-white/8 px-3 py-1 text-xs text-foreground" disabled={isPending} key={item} onClick={() => onDetachZettel(item)} type="button">
                {item} ×
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">연결된 지식이 없습니다.</p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <select className="flex-1 rounded-md border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => onZettelChange(event.target.value)} value={zettelId}>
            {attachableZettels.map((zettel) => (
              <option key={zettel.id} value={zettel.id}>
                {zettel.title}
              </option>
            ))}
          </select>
          <button className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground disabled:opacity-50" disabled={isPending || !zettelId || !attachableZettels.length} onClick={onAttachZettel} type="button">
            연결
          </button>
        </div>
      </GlassCard>
    </>
  );
}

function TaskContextPanel({ project, refreshKey, task }: { project: ProjectMock; refreshKey: number; task: TaskMock }) {
  return (
    <ContextBundlePanel
      density="compact"
      enableAttach
      entityId={task.id}
      entityType="task"
      mainSlot={(bundle) => (
        <div className="space-y-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs tracking-[0.08em] text-primary">맥락 작업대</p>
            <p className="mt-2 text-sm text-muted-foreground">{project.title}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <MiniMetric label="사람" value={bundle.grouped.people.length} />
              <MiniMetric label="지식" value={bundle.grouped.zettels.length} />
              <MiniMetric label="날짜" value={bundle.grouped.dates.length} />
            </div>
          </div>
          <ContextMapMini bundle={bundle} />
        </div>
      )}
      railDefaultLens="overview"
      refreshKey={refreshKey}
    />
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/10 px-2 py-2">
      <p className="text-[10px] tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
