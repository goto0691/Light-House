type BackupItem = {
  id: string;
  createdAt: string;
  summary: string;
};

export function BackupHistoryList({ backups }: { backups: BackupItem[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-5">
      <p className="text-xs tracking-[0.08em] text-primary">백업 기록</p>
      <div className="mt-3 space-y-2">
        {backups.length ? (
          backups.map((backup) => (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm" key={backup.id}>
              <p className="text-foreground">{new Date(backup.createdAt).toLocaleString("ko-KR")}</p>
              <p className="mt-1 text-muted-foreground">{backup.summary}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">아직 기록된 백업 실행이 없습니다.</p>
        )}
      </div>
    </section>
  );
}
