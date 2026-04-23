"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { postSnapshotMutation } from "@/lib/snapshot-client";
import { GlassCard } from "@/components/shared/glass-card";
import { ZenEditor } from "@/components/shared/zen-editor";
import { useActionHubStore } from "@/stores/use-action-hub-store";

export function TaskWorkspaceClient({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [isPending, startTransition] = useTransition();
  const project = useActionHubStore((state) => state.projects.find((item) => item.id === projectId));
  const task = useActionHubStore((state) => state.tasks.find((item) => item.id === taskId));
  const replaceSnapshot = useActionHubStore((state) => state.replaceSnapshot);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");

  useEffect(() => {
    if (!task) return;
    setTitleDraft(task.title);
    setContentDraft(task.content);
  }, [task]);

  if (!project || !task) {
    return (
      <GlassCard>
        <p className="text-sm text-muted-foreground">태스크를 찾지 못했습니다.</p>
      </GlassCard>
    );
  }

  return (
    <section className="space-y-4">
      <GlassCard>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Zen Workspace</p>
            <input
              className="mt-3 w-full rounded-2xl border border-transparent bg-transparent px-0 text-3xl font-semibold text-foreground outline-none focus:border-white/10"
              onChange={(event) => setTitleDraft(event.target.value)}
              value={titleDraft}
            />
            <p className="mt-3 text-sm text-muted-foreground">{project.title}</p>
          </div>
          <div className="flex gap-2">
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
            <button
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/action-hub/tasks/${task.id}/title`,
                      { title: titleDraft },
                      replaceSnapshot,
                    );
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/action-hub/tasks/${task.id}/content`,
                      { content: contentDraft },
                      replaceSnapshot,
                    );
                    toast.success("작업 내용을 D1에 저장했습니다.");
                  } catch (error) {
                    toast.error("저장에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              저장
            </button>
            <Link className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground" href={`/action-hub/${projectId}`}>
              칸반으로 복귀
            </Link>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <GlassCard className="h-fit">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Meta</p>
          <div className="mt-4 space-y-4">
            <MetaRow label="Status" value={task.status} />
            <MetaRow label="Priority" value={task.priority} />
            <MetaRow label="Energy" value={task.brainEnergy} />
            <MetaRow label="Due" value={task.dueAt ?? "-"} />
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Checklist</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {task.checklist.completed} / {task.checklist.total} 완료
            </p>
          </div>

          <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Linked People</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {task.linkedPeople.map((person) => (
                <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-foreground" key={person}>
                  {person}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Linked Zettels</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {task.linkedZettels.map((item) => (
                <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-foreground" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        </GlassCard>

        <ZenEditor onChange={setContentDraft} serif={task.kind === "writing"} value={contentDraft} />
      </div>
    </section>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
