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
    throw new Error(payload.error ?? "Mutation failed.");
  }

  if ("snapshot" in payload && payload.snapshot) {
    replaceSnapshot(payload.snapshot);
  }

  return payload;
}
