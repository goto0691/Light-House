"use client";

import { ArchiveRestore, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function mutateRecord(recordId: string, action: "trash" | "restore") {
  const response = await fetch(`/api/v2/records/${recordId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Request failed with ${response.status}.`);
}

export function RecordLifecycleActions({ recordId, deleted }: { recordId: string; deleted: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act() {
    if (!deleted && !window.confirm("이 기록을 휴지통으로 옮길까요? 원본과 수정 이력은 보존되며 다시 복원할 수 있습니다.")) return;
    setPending(true);
    setError(null);
    try {
      await mutateRecord(recordId, deleted ? "restore" : "trash");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상태를 바꾸지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="v2-record-lifecycle">
      <button className={deleted ? "v2-record-restore" : "v2-record-trash"} disabled={pending} onClick={act} type="button">
        {pending ? <LoaderCircle aria-hidden="true" className="v2-spinner" size={16} /> : deleted ? <ArchiveRestore aria-hidden="true" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
        {pending ? "처리 중" : deleted ? "기록 복원" : "휴지통으로"}
      </button>
      {error ? <p className="v2-product-error" role="alert">{error}</p> : null}
    </div>
  );
}
