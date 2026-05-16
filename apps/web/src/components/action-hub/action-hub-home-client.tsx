"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ProjectCard } from "@/components/action-hub/project-card";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { PROJECT_KIND_OPTIONS } from "@/lib/properties/project";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { useActionHubStore, type ActionHubProjectDelta } from "@/stores/use-action-hub-store";

export function ActionHubHomeClient() {
  const [isPending, startTransition] = useTransition();
  const projects = useActionHubStore((state) => state.projects);
  const applyProjectDelta = useActionHubStore((state) => state.applyProjectDelta);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"project" | "area">("project");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState<"all" | "project" | "area" | "archived">("all");
  const [query, setQuery] = useState("");

  const visibleProjects = projects.filter((project) => {
    if (filter === "project" && project.kind !== "project") return false;
    if (filter === "area" && project.kind !== "area") return false;
    if (filter === "archived") return false;
    if (query && !`${project.title} ${project.category}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <PageLayout>
      <PageHeader
        eyebrow="작업실"
        title="프로젝트"
        description="프로젝트와 영역을 만들고, 작업 보드로 진입하는 시작점입니다."
        actions={
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "전체"],
              ["project", "프로젝트"],
              ["area", "영역"],
              ["archived", "보관"],
            ] as const).map(([key, label]) => (
              <button
                aria-pressed={filter === key}
                className={`rounded-md px-3 py-2 text-xs tracking-[0.08em] ${
                  filter === key ? "border border-primary/20 bg-primary/10 text-primary" : "border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground"
                }`}
                key={key}
                onClick={() => setFilter(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      <PageBody
        aside={
          <GlassCard priority="secondary">
            <p className="text-xs tracking-[0.08em] text-primary">새 프로젝트</p>
            <div className="mt-3 space-y-3">
              <input className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setTitle(event.target.value)} placeholder="프로젝트 이름" value={title} />
              <div className="grid gap-3 md:grid-cols-2">
                <select className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setKind(event.target.value as "project" | "area")} value={kind}>
                  {PROJECT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setCategory(event.target.value)} placeholder="카테고리" value={category} />
              </div>
              <button
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await postDeltaMutation<{ delta: ActionHubProjectDelta }, ActionHubProjectDelta>(
                        "/api/action-hub/projects",
                        { title, kind, category },
                        applyProjectDelta,
                      );
                      setTitle("");
                      setCategory("");
                      toast.success("프로젝트를 만들었습니다.");
                    } catch (error) {
                      toast.error("프로젝트 생성에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                type="button"
              >
                생성
              </button>
            </div>
          </GlassCard>
        }
        asideWidth="md"
      >
        <PageToolbar>
          <FilterBar
            filters={[
              {
                kind: "select",
                key: "kind",
                label: "종류",
                options: PROJECT_KIND_OPTIONS,
              },
            ]}
            onChange={(state) => {
              setQuery(state.q);
              const nextKind = typeof state.filters.kind === "string" ? state.filters.kind : "";
              setFilter(nextKind === "project" || nextKind === "area" ? nextKind : "all");
            }}
            rightSlot={<span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs tracking-[0.08em] text-muted-foreground">{visibleProjects.length}개</span>}
            searchPlaceholder="프로젝트, 영역, 카테고리 검색"
          />
        </PageToolbar>

        <div className="app-grid app-grid-cards mt-4">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </PageBody>
    </PageLayout>
  );
}
