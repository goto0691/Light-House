"use client";

export type ImportPreview = {
  fileName: string;
  counts: Record<string, number>;
  samples: {
    zettels: Array<{ title: string; category?: string }>;
    tasks: Array<{ title: string; status?: string; priority?: string }>;
    projects: Array<{ title: string; category?: string; targetDate?: string }>;
    people: Array<{ name: string; nickname?: string }>;
    gifts: Array<{ title: string; personName?: string }>;
    dailyLogs: Array<{ date: string; journal?: string }>;
    workouts: Array<{ date: string; categories: string[] }>;
    careerEntries: Array<{ organization: string; role: string }>;
    mediaLogs: Array<{ title: string; mediaType: string; platformOrPublisher?: string }>;
  };
  warnings: string[];
};

type DataImportWizardProps = {
  selectedFile: File | null;
  preview: ImportPreview | null;
  previewLoading: boolean;
  importing: boolean;
  onFileChange: (file: File | null) => void;
  onPreview: () => void;
  onImport: () => void;
};

export function DataImportWizard({ selectedFile, preview, previewLoading, importing, onFileChange, onPreview, onImport }: DataImportWizardProps) {
  const totalPreviewItems = preview ? Object.values(preview.counts).reduce((sum, count) => sum + count, 0) : 0;

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Data Import Wizard</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">노션 가져오기</h1>
      <p className="mt-3 text-sm text-muted-foreground">Notion export zip, CSV, Markdown을 올리면 분류 미리보기 후 실제 import를 실행합니다.</p>

      <div className="mt-5 rounded-3xl border border-white/10 bg-black/10 p-4">
        <label className="text-sm font-medium text-foreground" htmlFor="notion-import-file">
          Step 1. 가져올 파일
        </label>
        <input
          accept=".zip,.csv,.md,.markdown,.txt"
          className="mt-3 block w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
          id="notion-import-file"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          type="file"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={previewLoading} onClick={onPreview} type="button">
            {previewLoading ? "Step 2. 미리보기 생성 중..." : "Step 2. 미리보기"}
          </button>
          <button className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-foreground disabled:opacity-50" disabled={importing || !selectedFile} onClick={onImport} type="button">
            {importing ? "Step 4. 가져오는 중..." : "Step 4. 실행"}
          </button>
        </div>
      </div>

      {preview ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-black/10 p-4">
          <p className="text-sm text-foreground">
            <span className="font-medium">{preview.fileName}</span> 에서 총 {totalPreviewItems}개 항목을 감지했습니다.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {Object.entries(preview.counts).map(([key, value]) => (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3" key={key}>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{key}</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
