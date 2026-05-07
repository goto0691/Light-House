import type { SavedView } from "@/lib/server/ui-state";

export type SavedViewMutationInput = {
  domain: string;
  scope: string;
  name: string;
  icon?: string | null;
  searchQuery?: string;
  filterState?: Record<string, unknown>;
  sortState?: Record<string, unknown>;
  viewKey?: string | null;
  isDefault?: boolean;
  displayOrder?: number;
};

export function getSavedViewKey(view: SavedView | null | undefined) {
  return view?.viewKey ?? view?.id ?? null;
}

export function getDefaultSavedViewKey(views: SavedView[]) {
  return getSavedViewKey(views.find((view) => view.isDefault)) ?? getSavedViewKey(views[0]);
}

export function isPersistedSavedView(view: SavedView | null | undefined) {
  return Boolean(view && !view.id.startsWith("default-"));
}

export function slugifySavedViewKey(value: string, fallback = "saved-view") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48) || fallback;
}

export async function createSavedViewClient(input: SavedViewMutationInput) {
  const response = await fetch("/api/saved-views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { views?: SavedView[]; error?: string };
  if (!response.ok || !payload.views) {
    throw new Error(payload.error ?? "저장된 뷰 생성에 실패했습니다.");
  }
  return payload.views;
}

export async function updateSavedViewClient(viewId: string, input: Partial<Omit<SavedViewMutationInput, "domain" | "scope">>) {
  const response = await fetch(`/api/saved-views/${viewId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { views?: SavedView[]; error?: string };
  if (!response.ok || !payload.views) {
    throw new Error(payload.error ?? "저장된 뷰 업데이트에 실패했습니다.");
  }
  return payload.views;
}

export async function deleteSavedViewClient(viewId: string) {
  const response = await fetch(`/api/saved-views/${viewId}`, { method: "DELETE" });
  const payload = (await response.json()) as { success?: boolean; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "저장된 뷰 삭제에 실패했습니다.");
  }
  return payload.success ?? true;
}

export async function listSavedViewsClient(domain: string, scope: string) {
  const params = new URLSearchParams({ domain, scope });
  const response = await fetch(`/api/saved-views?${params.toString()}`, { cache: "no-store" });
  const payload = (await response.json()) as { views?: SavedView[]; error?: string };
  if (!response.ok || !payload.views) {
    throw new Error(payload.error ?? "저장된 뷰 목록을 다시 불러오지 못했습니다.");
  }
  return payload.views;
}
