"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { postSnapshotMutation } from "@/lib/snapshot-client";
import { TaskCard } from "@/components/action-hub/task-card";
import { GlassCard } from "@/components/shared/glass-card";
import { useActionHubStore } from "@/stores/use-action-hub-store";

const COLUMNS = [
  { key: "todo", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
  { key: "blocked", label: "Blocked" },
] as const;

export function KanbanClient({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const tasks = useActionHubStore((state) => state.tasks.filter((task) => task.projectId === projectId));
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      {COLUMNS.map((column) => {
        const items = tasks.filter((task) => task.status === column.key);
        return (
          <GlassCard className="min-h-[420px]" key={column.key}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground">{column.label}</h2>
              <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-muted-foreground">{items.length}</span>
            </div>
            <div className="mt-4 space-y-3">
              {items.map((task) => (
                <div key={task.id}>
                  <TaskCard projectId={projectId} task={task} />
                  <div className="mt-2 flex justify-end">
                    <button
                      className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-muted-foreground"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                              `/api/action-hub/tasks/${task.id}/cycle-status`,
                              undefined,
                              replaceSnapshot,
                            );
                            toast.success("태스크 상태를 다음 단계로 이동했습니다.");
                          } catch (error) {
                            toast.error("상태 이동에 실패했습니다.", {
                              description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                            });
                          }
                        });
                      }}
                      type="button"
                    >
                      상태 이동
                    </button>
                  </div>
                </div>
              ))}
              {!items.length ? (
                <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">비어 있습니다.</div>
              ) : null}
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
