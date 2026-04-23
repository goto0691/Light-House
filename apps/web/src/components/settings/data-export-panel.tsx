"use client";

export type RestoreDryRun = {
  fileName: string;
  valid: boolean;
  manifest: {
    exportedAt: string | null;
    domains: string[];
    format: string | null;
  };
  counts: Record<string, number>;
  warnings: string[];
};

type DataExportPanelProps = {
  restoreFile: File | null;
  restoreDryRun: RestoreDryRun | null;
  restoreChecking: boolean;
  onRestoreFileChange: (file: File | null) => void;
  onRestoreDryRun: () => void;
};

export function DataExportPanel({ restoreFile, restoreDryRun, restoreChecking, onRestoreFileChange, onRestoreDryRun }: DataExportPanelProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Data Export Panel</p>
      <h2 className="mt-3 font-display text-4xl text-foreground">내보내기와 복원 검증</h2>
      <div className="mt-5 flex flex-wrap gap-2">
        <a className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href="/api/export?domains=all&format=json">
          JSON ZIP 다운로드
        </a>
        <a className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-foreground" href="/api/export?domains=all&format=markdown">
          Markdown ZIP 다운로드
        </a>
      </div>

      <div className="mt-5 rounded-3xl border border-white/10 bg-black/10 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">복원 드라이런</p>
        <p className="mt-2 text-sm text-muted-foreground">실제 반영 없이 export zip의 manifest와 도메인별 JSON을 검증합니다.</p>
        <input
          accept=".zip"
          className="mt-3 block w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
          onChange={(event) => onRestoreFileChange(event.target.files?.[0] ?? null)}
          type="file"
        />
        <button className="mt-3 rounded-2xl border border-white/10 px-4 py-2 text-sm text-foreground disabled:opacity-50" disabled={restoreChecking || !restoreFile} onClick={onRestoreDryRun} type="button">
          {restoreChecking ? "검증 중..." : "복원 드라이런"}
        </button>
        {restoreDryRun ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
            <p className="text-foreground">
              {restoreDryRun.fileName} · {restoreDryRun.valid ? "검증 통과" : "검증 필요"}
            </p>
            <p className="text-muted-foreground">
              {restoreDryRun.manifest.exportedAt ? new Date(restoreDryRun.manifest.exportedAt).toLocaleString("ko-KR") : "내보낸 시각 없음"} · {restoreDryRun.manifest.format ?? "포맷 없음"}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(restoreDryRun.counts).map(([key, value]) => (
                <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3" key={key}>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{key}</p>
                  <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-primary">domains: {restoreDryRun.manifest.domains.join(", ") || "없음"}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
