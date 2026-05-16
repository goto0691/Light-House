"use client";

type SnapshotWriter<TSnapshot> = (snapshot: TSnapshot) => void;

export async function postSnapshotMutation<TPayload, TSnapshot>(
  url: string,
  body: Record<string, unknown> | undefined,
  replaceSnapshot: SnapshotWriter<TSnapshot>,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json()) as TPayload & { error?: string; snapshot?: TSnapshot };
  if (!response.ok) {
    throw new Error(payload.error ?? "변경 사항 저장에 실패했습니다.");
  }

  if ("snapshot" in payload && payload.snapshot) {
    replaceSnapshot(payload.snapshot);
  }

  return payload;
}

export async function postDeltaMutation<TPayload, TDelta>(
  url: string,
  body: Record<string, unknown> | undefined,
  applyDelta: (delta: TDelta) => void,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json()) as TPayload & { delta?: TDelta; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "변경 사항 저장에 실패했습니다.");
  }

  if ("delta" in payload && payload.delta) {
    applyDelta(payload.delta);
  }

  return payload;
}

export async function postJsonMutation<TPayload>(url: string, body?: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json()) as TPayload & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "변경 사항 저장에 실패했습니다.");
  }

  return payload;
}
