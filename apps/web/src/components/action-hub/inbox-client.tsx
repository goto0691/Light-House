"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useActionHubStore } from "@/stores/use-action-hub-store";

export function InboxClient() {
  const [isPending, startTransition] = useTransition();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const projects = useActionHubStore((state) => state.projects);
  const pendingCaptures = useActionHubStore((state) => state.pendingCaptures);
  const tasks = useActionHubStore((state) => state.tasks);
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);
  const inboxTasks = useMemo(() => tasks.filter((task) => task.projectId === null), [tasks]);
  const routableProjects = useMemo(() => projects.filter((project) => project.progress < 100), [projects]);
  const targetProjectId = selectedProjectId || routableProjects[0]?.id || "";
  const targetProjectTitle = routableProjects.find((project) => project.id === targetProjectId)?.title;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs tracking-[0.08em] text-primary">검토 대기 캡처</p>
        <div className="mt-4 space-y-3">
          {pendingCaptures.length ? (
            pendingCaptures.map((capture) => (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={capture.id}>
                <p className="text-sm font-medium text-foreground">{capture.text}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  AI 제안: {capture.suggestedDomain} · 신뢰도 {Math.round(capture.confidence * 100)}%
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/captures/${capture.id}/accept`,
                            undefined,
                            replaceSnapshot,
                          );
                          toast.success("캡처 제안을 수락했습니다.");
                        } catch (error) {
                          toast.error("캡처 정리에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    수락
                  </button>
                  <button
                    className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/captures/${capture.id}/dismiss`,
                            undefined,
                            replaceSnapshot,
                          );
                          toast.success("캡처를 삭제했습니다.");
                        } catch (error) {
                          toast.error("캡처 삭제에 실패했습니다.", {
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
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">현재 검토 대기 중인 캡처가 없습니다.</div>
          )}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">미분류 작업</p>
            <p className="mt-2 text-sm text-muted-foreground">미분류 태스크를 실제 프로젝트로 보냅니다.</p>
          </div>
          <label className="min-w-0 text-xs font-medium text-muted-foreground sm:w-56">
            보낼 프로젝트
            <select
              className="mt-2 w-full rounded-2xl border border-white/10 bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
              disabled={isPending || routableProjects.length === 0}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              value={targetProjectId}
            >
              {routableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 space-y-3">
          {inboxTasks.length ? (
            inboxTasks.map((task) => (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={task.id}>
                <p className="text-sm font-medium text-foreground">{task.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{task.content}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                    disabled={isPending || !targetProjectId}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/tasks/${task.id}/route`,
                            { projectId: targetProjectId },
                            replaceSnapshot,
                          );
                          toast.success(`${targetProjectTitle ?? "선택한 프로젝트"}로 보냈습니다.`);
                        } catch (error) {
                          toast.error("프로젝트 라우팅에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    프로젝트로 보내기
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">Inbox 태스크가 비어 있습니다.</div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
