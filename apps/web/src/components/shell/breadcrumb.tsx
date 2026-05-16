"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ROUTE_SEGMENT_LABELS } from "@/constants/display-labels";

function detailLabelForSegment(segment: string, segments: string[], index: number) {
  const staticLabel = ROUTE_SEGMENT_LABELS[segment];
  if (staticLabel) return staticLabel;

  const previous = segments[index - 1];
  if (previous === "zettels") return "지식 상세";
  if (previous === "media") return "미디어 상세";
  if (previous === "assets") return "자산 상세";
  if (previous === "places") return "장소 상세";
  if (previous === "gifts") return "선물 상세";
  if (previous === "tasks") return "작업 상세";
  if (previous === "prm" || previous === "people") return "관계 상세";
  if (previous === "action-hub") return segment.startsWith("task") ? "작업 상세" : "프로젝트 상세";

  if (segment.startsWith("ztl_") || segment.startsWith("zettel-")) return "지식 상세";
  if (segment.startsWith("per_") || segment.startsWith("person-")) return "관계 상세";
  if (segment.startsWith("task-")) return "작업 상세";
  if (segment.startsWith("prj_") || segment.startsWith("project-") || segment.startsWith("area-")) return "프로젝트 상세";
  if (segment.startsWith("media-")) return "미디어 상세";
  if (segment.startsWith("asset-")) return "자산 상세";
  if (segment.startsWith("place-")) return "장소 상세";
  if (segment.startsWith("gift-")) return "선물 상세";

  return segment;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs = useMemo(
    () =>
      segments.map((segment, index) => {
        const href = `/${segments.slice(0, index + 1).join("/")}`;
        return {
          href,
          label: detailLabelForSegment(segment, segments, index),
        };
      }),
    [segments],
  );

  return (
    <div className="sticky top-0 z-10 flex min-h-12 items-center border-b border-white/10 bg-[rgba(14,17,22,0.72)] px-4 backdrop-blur-xl md:px-6">
      <nav aria-label="현재 위치" className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="mr-2 hidden rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-primary md:inline-flex">
          Light House
        </span>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={crumb.href} className="flex items-center gap-2">
              {last ? (
                <span className="font-medium text-foreground">{crumb.label}</span>
              ) : (
                <Link className="hover:text-foreground" href={crumb.href}>
                  {crumb.label}
                </Link>
              )}
              {!last ? <span className="text-white/20">/</span> : null}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
