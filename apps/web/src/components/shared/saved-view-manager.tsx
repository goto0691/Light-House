"use client";

import { Check, Copy, Pencil, Save, Star, Trash2 } from "lucide-react";

import { getSavedViewKey, isPersistedSavedView } from "@/lib/saved-view-client";
import type { SavedView } from "@/lib/server/ui-state";

type SavedViewManagerProps = {
  activeViewKey: string;
  mutationId: string | null;
  onCreateCurrent?: () => void;
  onDelete: (view: SavedView) => void;
  onDuplicate: (view: SavedView) => void;
  onMakeDefault: (view: SavedView) => void;
  onOverwrite: (view: SavedView) => void;
  onRename: (view: SavedView) => void;
  onRenameDraftChange: (viewId: string, name: string) => void;
  renameDrafts: Record<string, string>;
  views: SavedView[];
  createCurrentLabel?: string;
  title?: string;
};

export function SavedViewManager({
  activeViewKey,
  createCurrentLabel = "현재 상태 새 뷰",
  mutationId,
  onCreateCurrent,
  onDelete,
  onDuplicate,
  onMakeDefault,
  onOverwrite,
  onRename,
  onRenameDraftChange,
  renameDrafts,
  title = "저장된 뷰 편집",
  views,
}: SavedViewManagerProps) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] text-muted-foreground">
            전체 {views.length}개
          </span>
          {onCreateCurrent ? (
            <button
              className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground hover:bg-white/8"
              onClick={onCreateCurrent}
              type="button"
            >
              <Save className="h-4 w-4" />
              {createCurrentLabel}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {views.map((view) => {
          const viewKey = getSavedViewKey(view) ?? view.id;
          const persisted = isPersistedSavedView(view);
          const busy = mutationId === view.id;
          const draftName = renameDrafts[view.id] ?? view.name;
          const active = activeViewKey === viewKey;

          return (
            <div className="grid gap-3 rounded-md border border-white/10 bg-black/10 p-3 lg:grid-cols-[minmax(0,1fr)_auto]" key={view.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`${view.name} 이름`}
                    className="input-base h-10 min-h-10 max-w-lg py-0 text-sm"
                    onChange={(event) => onRenameDraftChange(view.id, event.target.value)}
                    value={draftName}
                  />
                  {view.isDefault ? <ViewBadge label="기본" /> : null}
                  {active ? <ViewBadge label="선택됨" /> : null}
                  <ViewBadge label={persisted ? "저장됨" : "시스템"} />
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">{view.searchQuery || viewKey}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {persisted ? (
                  <>
                    <button
                      className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy || !draftName.trim() || draftName.trim() === view.name}
                      onClick={() => onRename(view)}
                      title="이름 저장"
                      type="button"
                    >
                      <Check className="h-4 w-4" />
                      이름
                    </button>
                    <button
                      className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy}
                      onClick={() => onOverwrite(view)}
                      title="현재 검색과 필터로 덮어쓰기"
                      type="button"
                    >
                      <Save className="h-4 w-4" />
                      조건
                    </button>
                    <button
                      className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy || view.isDefault}
                      onClick={() => onMakeDefault(view)}
                      title="기본 뷰로 설정"
                      type="button"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                    <button
                      className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy}
                      onClick={() => onDelete(view)}
                      title="삭제"
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <button
                    className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy}
                    onClick={() => onDuplicate(view)}
                    type="button"
                  >
                    <Copy className="h-4 w-4" />
                    편집본 만들기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ViewBadge({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}
