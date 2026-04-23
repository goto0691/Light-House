"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useActionHubStore } from "@/stores/use-action-hub-store";

const DEFAULT_PROJECT_ID = "project-modu-works";

export function InboxClient() {
  const [isPending, startTransition] = useTransition();
  const pendingCaptures = useActionHubStore((state) => state.pendingCaptures);
  const inboxTasks = useActionHubStore((state) => state.tasks.filter((task) => task.projectId === null));
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Pending Captures</p>
        <div className="mt-4 space-y-3">
          {pendingCaptures.length ? (
            pendingCaptures.map((capture) => (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={capture.id}>
                <p className="text-sm font-medium text-foreground">{capture.text}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  AI 제안: {capture.suggestedDomain} · confidence {Math.round(capture.confidence * 100)}%
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/captures/${capture.id}/dismiss`,
                            undefined,
                            replaceSnapshot,
                          );
                          toast.success("캡처를 검토 완료로 정리했습니다.");
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
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Inbox Tasks</p>
        <div className="mt-4 space-y-3">
          {inboxTasks.length ? (
            inboxTasks.map((task) => (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={task.id}>
                <p className="text-sm font-medium text-foreground">{task.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{task.content}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-2xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                            `/api/action-hub/tasks/${task.id}/route`,
                            { projectId: DEFAULT_PROJECT_ID },
                            replaceSnapshot,
                          );
                          toast.success("MODU WORKS 프로젝트로 보냈습니다.");
                        } catch (error) {
                          toast.error("프로젝트 라우팅에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    MODU WORKS로 보내기
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
