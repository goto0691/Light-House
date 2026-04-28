"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { BackupHistoryList } from "@/components/settings/backup-history-list";
import { DataExportPanel, type RestoreDryRun } from "@/components/settings/data-export-panel";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";

type DataSettingsClientProps = {
  initial: {
    entityCounts: {
      projects: number;
      tasks: number;
      people: number;
      zettels: number;
      media: number;
      workouts: number;
      dailyLogs: number;
    };
    relationHealth: {
      taskProjects: number;
      taskPeople: number;
      taskZettels: number;
      zettelPeople: number;
      mediaPeople: number;
      dailyPeople: number;
      zettelMedia: number;
    };
    duplicateMedia: Array<{
      title: string;
      mediaType: string;
      count: number;
    }>;
    savedViews: Array<{
      id: string;
      domain: string;
      scope: string;
      name: string;
      query: string | null;
    }>;
    backups: Array<{
      id: string;
      createdAt: string;
      summary: string;
    }>;
  };
};

const ENTITY_LABELS: Array<{ key: keyof DataSettingsClientProps["initial"]["entityCounts"]; label: string }> = [
  { key: "projects", label: "Projects" },
  { key: "tasks", label: "Tasks" },
  { key: "people", label: "People" },
  { key: "zettels", label: "Zettels" },
  { key: "media", label: "Media" },
  { key: "workouts", label: "Workouts" },
  { key: "dailyLogs", label: "Daily Logs" },
];

const RELATION_LABELS: Array<{ key: keyof DataSettingsClientProps["initial"]["relationHealth"]; label: string }> = [
  { key: "taskProjects", label: "Task -> Project" },
  { key: "taskPeople", label: "Task -> People" },
  { key: "taskZettels", label: "Task -> Zettel" },
  { key: "zettelPeople", label: "Zettel -> People" },
  { key: "zettelMedia", label: "Zettel -> Media" },
  { key: "mediaPeople", label: "Media -> People" },
  { key: "dailyPeople", label: "Daily -> People" },
];

export function DataSettingsClient({ initial }: DataSettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreDryRun, setRestoreDryRun] = useState<RestoreDryRun | null>(null);

  function postFile<T>(url: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return fetch(url, {
      method: "POST",
      body: formData,
    }).then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
      }
      return payload;
    });
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_420px]">
        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-primary">Data Health</p>
                <h2 className="mt-3 font-display text-4xl text-foreground">현재 적재 상태</h2>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {ENTITY_LABELS.map(({ key, label }) => (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={key}>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{initial.entityCounts[key]}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Relation Health</p>
            <h2 className="mt-3 font-display text-3xl text-foreground">연결 상태</h2>
            <div className="mt-5 flex flex-wrap gap-2">
              {RELATION_LABELS.map(({ key, label }) => (
                <Tag key={key} value={`${label}: ${initial.relationHealth[key]}`} variant="neutral" />
              ))}
            </div>
          </GlassCard>
        </div>
        <DataExportPanel
          onRestoreDryRun={() => {
            if (!restoreFile) {
              toast.error("복원 검증 파일을 먼저 선택해 주세요.");
              return;
            }
            if (!window.confirm("복원 파일 검증은 데이터를 변경하지 않지만 시간이 걸릴 수 있습니다. 계속할까요?")) {
              return;
            }

            startTransition(async () => {
              try {
                const result = await postFile<RestoreDryRun>("/api/settings/data/restore/dry-run", restoreFile);
                setRestoreDryRun(result);
                toast.success("복원 드라이런을 완료했습니다.");
              } catch (error) {
                toast.error("복원 검증에 실패했습니다.", {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
          onRestoreFileChange={(file) => {
            setRestoreFile(file);
            setRestoreDryRun(null);
          }}
          restoreChecking={isPending}
          restoreDryRun={restoreDryRun}
          restoreFile={restoreFile}
        />
        <BackupHistoryList backups={initial.backups} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard className="p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Saved Views</p>
          <h2 className="mt-3 font-display text-3xl text-foreground">저장된 뷰</h2>
          <div className="mt-5 space-y-3">
            {initial.savedViews.length ? (
              initial.savedViews.map((view) => (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3" key={view.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground">{view.name}</h3>
                    <Tag value={`${view.domain}/${view.scope}`} variant="neutral" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{view.query ?? "No query"}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">아직 저장된 뷰가 없습니다.</p>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Duplicate Media</p>
          <h2 className="mt-3 font-display text-3xl text-foreground">Merge candidates</h2>
          <div className="mt-5 space-y-3">
            {initial.duplicateMedia.length ? (
              initial.duplicateMedia.map((item) => (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3" key={`${item.mediaType}:${item.title}`}>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-foreground">{item.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{item.mediaType}</p>
                  </div>
                  <Tag value={`${item.count} copies`} variant="neutral" />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No duplicate media titles detected.</p>
            )}
          </div>
        </GlassCard>
      </div>
    </section>
  );
}
