import { Tag } from "@/components/shared/tag";
import type { SourceDocumentInfo } from "@/lib/mock/vault";

type SourceDocumentPanelProps = {
  sourceDocument?: SourceDocumentInfo | null;
};

export function SourceDocumentPanel({ sourceDocument }: SourceDocumentPanelProps) {
  if (!sourceDocument) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Source</p>
        <p className="mt-3 text-sm text-muted-foreground">No source document is linked yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Source</p>
          <h3 className="mt-2 text-lg font-medium text-foreground">{sourceDocument.sourceDatabase ?? "Notion"}</h3>
          <p className="mt-1 break-all text-xs text-muted-foreground">{sourceDocument.sourceId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sourceDocument.documentRole ? <Tag value={sourceDocument.documentRole} variant="neutral" /> : null}
          <Tag value={sourceDocument.status} variant="neutral" />
        </div>
      </div>

      {sourceDocument.preview ? <p className="mt-4 line-clamp-4 text-sm leading-6 text-muted-foreground">{sourceDocument.preview}</p> : null}

      {sourceDocument.properties.length ? (
        <div className="mt-4 grid gap-2">
          {sourceDocument.properties.slice(0, 8).map((property) => (
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs" key={`${property.name}:${property.value}`}>
              <span className="truncate uppercase tracking-[0.12em] text-muted-foreground">{property.name}</span>
              <span className="truncate text-foreground">{property.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
