"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { BackupHistoryList } from "@/components/settings/backup-history-list";
import { DataExportPanel, type RestoreDryRun } from "@/components/settings/data-export-panel";
import { DataImportWizard, type ImportPreview } from "@/components/settings/data-import-wizard";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";

type DataSettingsClientProps = {
  initial: {
    entityCounts: {
      projects: number;
      tasks: number;
      people: number;
      zettels: number;
      dailyLogs: number;
    };
    relationHealth: {
      taskProjects: number;
      taskPeople: number;
      taskZettels: number;
      zettelPeople: number;
      mediaPeople: number;
      importedProjects: number;
      importedTasks: number;
      importedZettels: number;
      importedMedia: number;
    };
    backups: Array<{
      id: string;
      createdAt: string;
      summary: string;
    }>;
    recentImports: Array<{
      id: string;
      importBatchId: string | null;
      createdAt: string;
      fileName: string;
      summary: string;
      restoreSummary: string;
    }>;
  };
};

type ImportResult = {
  importBatchId?: string | null;
  created: Record<string, number>;
  restored?: Record<string, number>;
};

const ENTITY_LABELS: Array<{ key: keyof DataSettingsClientProps["initial"]["entityCounts"]; label: string }> = [
  { key: "projects", label: "Projects" },
  { key: "tasks", label: "Tasks" },
  { key: "people", label: "People" },
  { key: "zettels", label: "Zettels" },
  { key: "dailyLogs", label: "Daily Logs" },
];

const RELATION_LABELS: Array<{ key: keyof DataSettingsClientProps["initial"]["relationHealth"]; label: string }> = [
  { key: "taskProjects", label: "Task → Project" },
  { key: "taskPeople", label: "Task → People" },
  { key: "taskZettels", label: "Task → Zettel" },
  { key: "zettelPeople", label: "Zettel → People" },
  { key: "mediaPeople", label: "Media → People" },
  { key: "importedProjects", label: "Imported Projects" },
  { key: "importedTasks", label: "Imported Tasks" },
  { key: "importedZettels", label: "Imported Zettels" },
  { key: "importedMedia", label: "Imported Media" },
];

export function DataSettingsClient({ initial }: DataSettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
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

  function summarizeCounts(record: Record<string, number> | undefined) {
    if (!record) return "기록 없음";
    const entries = Object.entries(record).filter(([, value]) => value > 0);
    if (!entries.length) return "변경 없음";
    return entries.map(([key, value]) => `${key}:${value}`).join(" · ");
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
        <DataImportWizard
          importing={isPending}
          onFileChange={(file) => {
            setSelectedFile(file);
            setPreview(null);
          }}
          onImport={() => {
            if (!selectedFile) {
              toast.error("가져올 파일을 먼저 선택해 주세요.");
              return;
            }

            startTransition(async () => {
              try {
                const result = await postFile<ImportResult>("/api/settings/data/notion/import", selectedFile);
                toast.success("Notion 가져오기를 완료했습니다.", {
                  description: summarizeCounts(result.created),
                });

                if (result.importBatchId) {
                  const repairResponse = await fetch("/api/settings/data/notion/repair", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ importBatchId: result.importBatchId }),
                  });
                  const repairPayload = (await repairResponse.json().catch(() => ({}))) as { error?: string; restored?: Record<string, number> };
                  if (repairResponse.ok) {
                    toast.success("관계 복원을 실행했습니다.", {
                      description: summarizeCounts(repairPayload.restored),
                    });
                  }
                }
              } catch (error) {
                toast.error("Notion 가져오기에 실패했습니다.", {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
          onPreview={() => {
            if (!selectedFile) {
              toast.error("미리볼 파일을 먼저 선택해 주세요.");
              return;
            }

            startTransition(async () => {
              try {
                const result = await postFile<ImportPreview>("/api/settings/data/notion/preview", selectedFile);
                setPreview(result);
                toast.success("가져오기 미리보기를 생성했습니다.");
              } catch (error) {
                toast.error("미리보기 생성에 실패했습니다.", {
                  description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                });
              }
            });
          }}
          preview={preview}
          previewLoading={isPending}
          selectedFile={selectedFile}
        />

        <div className="space-y-4">
          <GlassCard className="p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Data Health</p>
            <h2 className="mt-3 font-display text-4xl text-foreground">현재 적재 상태</h2>
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
            <h2 className="mt-3 font-display text-3xl text-foreground">이관 후 연결 상태</h2>
            <div className="mt-5 flex flex-wrap gap-2">
              {RELATION_LABELS.map(({ key, label }) => (
                <Tag key={key} value={`${label}: ${initial.relationHealth[key]}`} variant="neutral" />
              ))}
            </div>
          </GlassCard>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_420px]">
        <DataExportPanel
          onRestoreDryRun={() => {
            if (!restoreFile) {
              toast.error("복원 검증 파일을 먼저 선택해 주세요.");
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

      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Recent Import Jobs</p>
        <h2 className="mt-3 font-display text-4xl text-foreground">이관 배치 검수</h2>
        <div className="mt-5 space-y-3">
          {initial.recentImports.length ? (
            initial.recentImports.map((item) => (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{new Date(item.createdAt).toLocaleString("ko-KR")}</p>
                    <h3 className="mt-1 text-lg font-medium text-foreground">{item.fileName}</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:opacity-50"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          const response = await fetch("/api/settings/data/notion/repair", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ importBatchId: item.importBatchId }),
                          });
                          const payload = (await response.json().catch(() => ({}))) as { error?: string; restored?: Record<string, number> };
                          if (!response.ok) {
                            throw new Error(payload.error ?? "관계 복원에 실패했습니다.");
                          }
                          toast.success("배치 관계 복원을 완료했습니다.", {
                            description: summarizeCounts(payload.restored),
                          });
                        } catch (error) {
                          toast.error("관계 복원에 실패했습니다.", {
                            description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                          });
                        }
                      });
                    }}
                    type="button"
                  >
                    Repair
                  </button>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{item.summary}</p>
                <p className="mt-2 text-sm text-primary">{item.restoreSummary}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">아직 기록된 import batch가 없습니다.</p>
          )}
        </div>
      </GlassCard>
    </section>
  );
}
