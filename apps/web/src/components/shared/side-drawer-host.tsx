"use client";

import { useEffect, useRef } from "react";
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
      return "관계 상세";
    case "task":
      return "작업 상세";
    case "zettel":
      return "지식 상세";
    case "media":
      return "미디어 상세";
    case "place":
      return "장소 상세";
    default:
      return "상세";
  }
}

function typeLabelFor(entity: DrawerEntity) {
  switch (entity.type) {
    case "person":
      return "사람";
    case "task":
      return "작업";
    case "zettel":
      return "지식";
    case "media":
      return "미디어";
    case "place":
      return "장소";
    default:
      return "상세 항목";
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
          <section className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-foreground">{entity.id}</p>
            <p className="mt-2 text-sm text-muted-foreground">실제 DB 연결 전까지는 타입별 상세 패널과 URL 수명주기부터 먼저 구현했습니다.</p>
          </section>
          <section className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
            다음 단계에서 `{entity.type}` 전용 드로어 탭 구조를 세부 분리합니다.
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && entities.length) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("detail");
        router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
      }

      if (event.key === "Tab" && entities.length && containerRef.current) {
        const focusables = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((node) => !node.hasAttribute("disabled"));

        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entities.length, pathname, router, searchParams]);

  useEffect(() => {
    if (!entities.length || !containerRef.current) return;
    const focusables = containerRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusables[0]?.focus();
  }, [entities]);

  if (!entities.length) return null;

  const closeAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("detail");
    router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[2px]" onClick={closeAll}>
      <div className="pointer-events-none flex h-full items-stretch gap-3 p-3" ref={containerRef}>
        {entities.map((entity, index) => (
          <aside
            aria-modal="true"
            className={cn(
              "glass-elevated pointer-events-auto h-full w-[min(480px,92vw)] rounded-lg border border-white/10 p-5 shadow-2xl",
              index === 0 ? "translate-x-0" : "w-[min(420px,88vw)] translate-x-0",
            )}
            key={`${entity.type}:${entity.id}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs font-medium text-primary">{typeLabelFor(entity)}</p>
                <h2 className="mt-2 font-display text-3xl text-foreground">{titleFor(entity)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {index === 0 ? "선택한 항목의 세부 정보를 봅니다." : "함께 열린 보조 상세 패널입니다."}
                </p>
              </div>
              <button className="focus-ring rounded-md border border-white/10 px-3 py-2 text-sm text-muted-foreground [@media(hover:hover)]:hover:bg-white/8 [@media(hover:hover)]:hover:text-foreground" onClick={closeAll} type="button">
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
