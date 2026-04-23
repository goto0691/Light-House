"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

export function MediaClient() {
  const [isPending, startTransition] = useTransition();
  const media = useVaultStore((state) => state.media);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {media.map((item) => (
        <div className="glass rounded-[24px] p-5" key={item.id}>
          <Link className="block transition hover:translate-y-[-2px]" href={`/vault?detail=media:${item.id}`}>
            <div className="aspect-[4/3] rounded-[20px] bg-[linear-gradient(135deg,rgba(251,191,36,0.18),rgba(14,165,233,0.12))]" />
            <p className="mt-4 text-lg font-medium text-foreground">{item.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.creator}</p>
          </Link>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="rounded-full bg-white/8 px-2 py-1 text-muted-foreground">{item.mediaType}</span>
            <button
              className="rounded-full bg-primary/15 px-2 py-1 text-primary"
              onClick={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/vault/media/${item.id}/cycle-status`,
                      undefined,
                      replaceSnapshot,
                    );
                    toast.success(`${item.title} 상태를 변경했습니다.`);
                  } catch (error) {
                    toast.error("미디어 상태 변경에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              disabled={isPending}
              type="button"
            >
              {item.status}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
