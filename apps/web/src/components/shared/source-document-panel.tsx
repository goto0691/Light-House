import { Tag } from "@/components/shared/tag";
import type { SourceDocumentInfo } from "@/lib/mock/vault";

type SourceDocumentPanelProps = {
  sourceDocument?: SourceDocumentInfo | null;
};

export function SourceDocumentPanel({ sourceDocument }: SourceDocumentPanelProps) {
  if (!sourceDocument) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Record Properties</p>
        <p className="mt-3 text-sm text-muted-foreground">연결된 속성 정보가 아직 없습니다.</p>
      </section>
    );
  }

  const visibleProperties = sourceDocument.properties.filter((property) => property.value?.trim());
  const primaryProperties = visibleProperties.filter((property) =>
    ["날짜", "생성 일시", "카테고리", "유형", "상태", "평점", "플랫폼", "장르", "감정", "관련인물", "그룹", "생일", "핵심 가치"].includes(property.name),
  );
  const remainingProperties = visibleProperties.filter((property) => !primaryProperties.includes(property));

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Record Properties</p>
          <h3 className="mt-2 text-lg font-medium text-foreground">{sourceDocument.sourceDatabase ?? "Linked Record"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">현재 엔티티에 연결된 속성과 본문 단서입니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sourceDocument.documentRole ? <Tag value={sourceDocument.documentRole} variant="neutral" /> : null}
          <Tag value={sourceDocument.status} variant="neutral" />
        </div>
      </div>

      {sourceDocument.preview ? <p className="mt-4 line-clamp-4 text-sm leading-6 text-muted-foreground">{sourceDocument.preview}</p> : null}

      {visibleProperties.length ? (
        <div className="mt-4 grid gap-2">
          {(primaryProperties.length ? primaryProperties : visibleProperties.slice(0, 8)).map((property) => (
            <PropertyRow key={`${property.name}:${property.value}`} name={property.name} type={property.type} value={property.value} />
          ))}
          {remainingProperties.length ? (
            <details className="rounded-md border border-white/10 bg-black/10 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                전체 속성 보기 · {visibleProperties.length}개
              </summary>
              <div className="mt-3 grid gap-2">
                {remainingProperties.map((property) => (
                  <PropertyRow key={`${property.name}:${property.value}`} name={property.name} type={property.type} value={property.value} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PropertyRow({ name, type, value }: { name: string; type?: string | null; value: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs sm:grid-cols-[140px_minmax(0,1fr)]">
      <span className="truncate uppercase tracking-[0.12em] text-muted-foreground">
        {name}
        {type ? <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">{type}</span> : null}
      </span>
      <span className="break-words text-foreground">{value}</span>
    </div>
  );
}
