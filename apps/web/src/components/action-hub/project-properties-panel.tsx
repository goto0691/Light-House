"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { buildProjectPropertyForm, projectPropertyPayload, type ProjectPropertyForm } from "@/components/action-hub/project-property-form";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import type { ProjectMock } from "@/lib/mock/action-hub";
import { PROJECT_PROPERTY_DEFINITIONS, PROJECT_PROPERTY_GROUPS } from "@/lib/properties/project";
import { postDeltaMutation } from "@/lib/snapshot-client";
import { useActionHubStore, type ActionHubProjectDelta } from "@/stores/use-action-hub-store";

type ProjectPropertiesPanelProps = {
  project: ProjectMock;
};

export function ProjectPropertiesPanel({ project }: ProjectPropertiesPanelProps) {
  const [isPending, startTransition] = useTransition();
  const activeProject = useActionHubStore((state) => state.projects.find((item) => item.id === project.id)) ?? project;
  const applyProjectDelta = useActionHubStore((state) => state.applyProjectDelta);
  const [form, setForm] = useState<ProjectPropertyForm>(() => buildProjectPropertyForm(activeProject));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedProjectId, setSyncedProjectId] = useState(activeProject.id);

  useEffect(() => {
    if (isDirty && activeProject.id === syncedProjectId) return;
    setForm(buildProjectPropertyForm(activeProject));
    setSyncedProjectId(activeProject.id);
    setIsDirty(false);
  }, [activeProject, isDirty, syncedProjectId]);

  const saveProperties = () => {
    startTransition(async () => {
      try {
        await postDeltaMutation<{ delta: ActionHubProjectDelta }, ActionHubProjectDelta>(
          `/api/action-hub/projects/${activeProject.id}/properties`,
          projectPropertyPayload(form),
          applyProjectDelta,
        );
        setIsDirty(false);
        toast.success("프로젝트 속성을 저장했습니다.");
      } catch (error) {
        toast.error("프로젝트 속성 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">프로젝트 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">프로젝트의 기준 필드를 이 뷰에서 바로 조정합니다.</p>
          </div>
          <button className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={isPending} onClick={saveProperties} type="button">
            {isPending ? "저장 중..." : "속성 저장"}
          </button>
        </div>
      </section>
      <PropertyPanel
        definitions={PROJECT_PROPERTY_DEFINITIONS}
        form={form}
        groups={PROJECT_PROPERTY_GROUPS}
        onChange={(patch) => {
          setIsDirty(true);
          setForm((current) => ({ ...current, ...patch }));
        }}
      />
    </div>
  );
}
