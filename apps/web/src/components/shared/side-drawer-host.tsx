"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { TaskDrawer } from "@/components/action-hub/task-drawer";
import { PersonDrawer } from "@/components/prm/person-drawer";
import { cn } from "@/lib/utils/cn";
import { MediaDrawer } from "@/components/vault/media-drawer";
import { PlaceDrawer } from "@/components/vault/place-drawer";
import { ZettelDrawer } from "@/components/vault/zettel-drawer";

type DrawerEntity = {
  type: string;
  id: string;
};

function parseDetail(detail: string | null): DrawerEntity[] {
  if (!detail) return [];
  return detail
    .split(",")
    .map((segment) => {
      const [type, id] = segment.split(":");
      if (!type || !id) return null;
      return { type, id };
    })
    .filter((value): value is DrawerEntity => Boolean(value))
    .slice(0, 2);
}

function titleFor(entity: DrawerEntity) {
  switch (entity.type) {
    case "person":
      return "Relationship Detail";
    case "task":
      return "Task Drawer";
    case "zettel":
      return "Zettel Drawer";
    case "media":
      return "Media Drawer";
    case "place":
      return "Place Drawer";
    default:
      return "Detail Drawer";
  }
}

function renderDrawerBody(entity: DrawerEntity) {
  switch (entity.type) {
    case "person":
      return <PersonDrawer id={entity.id} />;
    case "task":
      return <TaskDrawer id={entity.id} />;
    case "zettel":
      return <ZettelDrawer id={entity.id} />;
    case "media":
      return <MediaDrawer id={entity.id} />;
    case "place":
      return <PlaceDrawer id={entity.id} />;
    default:
      return (
        <div className="space-y-4">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-foreground">{entity.id}</p>
            <p className="mt-2 text-sm text-muted-foreground">실제 DB 연결 전까지는 타입별 Drawer 템플릿과 URL 수명주기부터 먼저 구현했습니다.</p>
          </section>
          <section className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
            다음 단계에서 `{entity.type}` 전용 Drawer 탭 구조를 세부 분리합니다.
          </section>
        </div>
      );
  }
}

export function SideDrawerHost() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const entities = parseDetail(searchParams.get("detail"));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && entities.length) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("detail");
        router.replace(params.size ? `${pathname}?${params.toString()}` : pathname);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entities.length, pathname, router, searchParams]);

  if (!entities.length) return null;

  const closeAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("detail");
    router.replace(params.size ? `${pathname}?${params.toString()}` : pathname);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[2px]" onClick={closeAll}>
      <div className="pointer-events-none flex h-full items-stretch gap-3 p-3">
        {entities.map((entity, index) => (
          <aside
            className={cn(
              "glass-elevated pointer-events-auto h-full w-[min(480px,92vw)] rounded-[28px] border border-white/10 p-5 shadow-2xl transition",
              index === 0 ? "translate-x-0" : "translate-x-0",
            )}
            key={`${entity.type}:${entity.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-primary">{entity.type}</p>
                <h2 className="mt-2 text-xl font-semibold text-foreground">{titleFor(entity)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">URL 기반 Drawer 스택이 연결되었습니다.</p>
              </div>
              <button className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-muted-foreground" onClick={closeAll} type="button">
                닫기
              </button>
            </div>

            <div className="mt-5 space-y-4">{renderDrawerBody(entity)}</div>
          </aside>
        ))}
      </div>
    </div>
  );
}
