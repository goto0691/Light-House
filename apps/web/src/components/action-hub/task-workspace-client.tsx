"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { buildTaskPropertyForm, taskPropertyPayload, type TaskPropertyForm } from "@/components/action-hub/task-property-form";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { GlassCard } from "@/components/shared/glass-card";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { ZenEditor } from "@/components/shared/zen-editor";
import { TASK_PROPERTY_DEFINITIONS, TASK_PROPERTY_GROUPS } from "@/lib/properties/task";
import { useActionHubStore } from "@/stores/use-action-hub-store";

const WORKSPACE_TASK_PROPERTY_DEFINITIONS = TASK_PROPERTY_DEFINITIONS.filter((definition) => !["title", "content"].includes(definition.field));

export function TaskWorkspaceClient({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [isPending, startTransition] = useTransition();
  const project = useActionHubStore((state) => state.projects.find((item) => item.id === projectId));
  const task = useActionHubStore((state) => state.tasks.find((item) => item.id === taskId));
  const referencePeople = useActionHubStore((state) => state.referencePeople);
  const referenceZettels = useActionHubStore((state) => state.referenceZettels);
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);
  const [taskForm, setTaskForm] = useState<TaskPropertyForm | null>(task ? buildTaskPropertyForm(task) : null);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [personId, setPersonId] = useState("");
  const [zettelId, setZettelId] = useState("");
  const [contextRefreshKey, setContextRefreshKey] = useState(0);

  useEffect(() => {
    setTaskForm(task ? buildTaskPropertyForm(task) : null);
  }, [task]);

  useEffect(() => {
    if (!personId && referencePeople[0]?.id) setPersonId(referencePeople[0].id);
    if (!zettelId && referenceZettels[0]?.id) setZettelId(referenceZettels[0].id);
  }, [personId, referencePeople, referenceZettels, zettelId]);

  const attachablePeople = useMemo(() => referencePeople.filter((item) => !task?.linkedPeople.includes(item.title)), [referencePeople, task?.linkedPeople]);
  const attachableZettels = useMemo(() => referenceZettels.filter((item) => !task?.linkedZettels.includes(item.title)), [referenceZettels, task?.linkedZettels]);

  if (!project || !task || !taskForm) {
    return (
      <GlassCard>
        <p className="text-sm text-muted-foreground">태스크를 찾지 못했습니다.</p>
      </GlassCard>
    );
  }

  const activeTask = task;

  function saveTaskProperties() {
    if (!taskForm) return;
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/action-hub/tasks/${activeTask.id}/properties`,
          taskPropertyPayload(taskForm),
          replaceSnapshot,
        );
        setContextRefreshKey((value) => value + 1);
        toast.success("작업 속성을 저장했습니다.");
      } catch (error) {
        toast.error("작업 속성 저장에 실패했습니다.", {
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
            <p className="text-xs tracking-[0.08em] text-primary">작업 워크스페이스</p>
            <input
              className="mt-3 w-full rounded-2xl border border-transparent bg-transparent px-0 text-3xl font-semibold text-foreground outline-none focus:border-white/10"
              onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
              value={taskForm.title}
            />
            <p className="mt-3 text-sm text-muted-foreground">{project.title}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/action-hub/tasks/${task.id}/cycle-status`,
                      undefined,
                      replaceSnapshot,
                    );
                    toast.success("상태를 다음 단계로 변경했습니다.");
                  } catch (error) {
                    toast.error("상태 변경에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              상태 이동
            </button>
            <button className="rounded-2xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={isPending} onClick={saveTaskProperties} type="button">
              {isPending ? "저장 중..." : "저장"}
            </button>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}`} scroll={false}>
              칸반으로 복귀
            </Link>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <PropertyPanel
            definitions={WORKSPACE_TASK_PROPERTY_DEFINITIONS}
            form={taskForm}
            groups={TASK_PROPERTY_GROUPS}
            onChange={(patch) => setTaskForm({ ...taskForm, ...patch })}
            title="작업 속성"
          />

          <GlassCard>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs tracking-[0.08em] text-primary">체크리스트</p>
              <p className="text-sm text-muted-foreground">
                {task.checklist.completed} / {task.checklist.total}
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {task.checklistItems.map((item) => (
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/10 px-3 py-3" key={item.id}>
                  <button
                    aria-label={`${item.content} 체크리스트 ${item.completed ? "미완료로 변경" : "완료로 변경"}`}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${item.completed ? "border-primary bg-primary" : "border-white/20"}`}
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/checklists/${item.id}/toggle`,
                            undefined,
                            replaceSnapshot,
                          );
                        } catch (error) {
                          toast.error("체크리스트 상태 변경에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  />
                  <p className={`flex-1 text-sm ${item.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.content}</p>
                  <button
                    aria-label={`${item.content} 체크리스트 삭제`}
                    className="min-h-11 rounded-xl border border-white/10 px-3 py-2 text-[11px] text-muted-foreground"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/checklists/${item.id}/delete`,
                            undefined,
                            replaceSnapshot,
                          );
                        } catch (error) {
                          toast.error("체크리스트 삭제에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input className="flex-1 rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setChecklistDraft(event.target.value)} placeholder="새 체크리스트" value={checklistDraft} />
              <button
                className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/action-hub/tasks/${task.id}/checklists`,
                        { content: checklistDraft },
                        replaceSnapshot,
                      );
                      setChecklistDraft("");
                    } catch (error) {
                      toast.error("체크리스트 추가에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                type="button"
              >
                추가
              </button>
            </div>
          </GlassCard>

          <GlassCard>
            <p className="text-xs tracking-[0.08em] text-primary">연결된 사람</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {task.linkedPeople.length ? (
                task.linkedPeople.map((person) => (
                  <button
                    className="rounded-full bg-white/8 px-3 py-1 text-xs text-foreground"
                    key={person}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/tasks/${task.id}/people`,
                            { mode: "detach", personName: person },
                            replaceSnapshot,
                          );
                        } catch (error) {
                          toast.error("인물 연결 해제에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    {person} ×
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">연결된 사람이 없습니다.</p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <select className="flex-1 rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setPersonId(event.target.value)} value={personId}>
                {attachablePeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.title}
                  </option>
                ))}
              </select>
              <button
                className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
                disabled={isPending || !personId}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/action-hub/tasks/${task.id}/people`,
                        { personId },
                        replaceSnapshot,
                      );
                    } catch (error) {
                      toast.error("인물 연결에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                type="button"
              >
                연결
              </button>
            </div>
          </GlassCard>

          <GlassCard>
            <p className="text-xs tracking-[0.08em] text-primary">연결된 메모</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {task.linkedZettels.length ? (
                task.linkedZettels.map((item) => (
                  <button
                    className="rounded-full bg-white/8 px-3 py-1 text-xs text-foreground"
                    key={item}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/tasks/${task.id}/zettels`,
                            { mode: "detach", zettelTitle: item },
                            replaceSnapshot,
                          );
                        } catch (error) {
                          toast.error("메모 연결 해제에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    {item} ×
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">연결된 메모가 없습니다.</p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <select className="flex-1 rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-foreground" onChange={(event) => setZettelId(event.target.value)} value={zettelId}>
                {attachableZettels.map((zettel) => (
                  <option key={zettel.id} value={zettel.id}>
                    {zettel.title}
                  </option>
                ))}
              </select>
              <button
                className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
                disabled={isPending || !zettelId}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/action-hub/tasks/${task.id}/zettels`,
                        { zettelId },
                        replaceSnapshot,
                      );
                    } catch (error) {
                      toast.error("메모 연결에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                type="button"
              >
                연결
              </button>
            </div>
          </GlassCard>
        </div>

        <ZenEditor onChange={(content) => setTaskForm({ ...taskForm, content })} serif={taskForm.kind === "writing"} value={taskForm.content} />

        <ContextBundlePanel
          density="compact"
          enableAttach
          entityId={task.id}
          entityType="task"
          mainSlot={(bundle) => (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs tracking-[0.08em] text-primary">컨텍스트 워크스페이스</p>
                <p className="mt-2 text-sm text-muted-foreground">{project.title}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <MiniMetric label="사람" value={bundle.grouped.people.length} />
                  <MiniMetric label="메모" value={bundle.grouped.zettels.length} />
                  <MiniMetric label="날짜" value={bundle.grouped.dates.length} />
                </div>
              </div>
              <ContextMapMini bundle={bundle} />
            </div>
          )}
          railDefaultLens="overview"
          refreshKey={contextRefreshKey}
        />
      </div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 px-2 py-2">
      <p className="text-[10px] tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
