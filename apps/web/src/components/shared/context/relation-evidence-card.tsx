import type { ContextEdge } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";

const KIND_LABELS: Record<ContextEdge["kind"], string> = {
  explicit: "확정",
  source: "원본",
  mention: "멘션",
  inferred: "검토 필요",
  semantic: "추천",
};

const KIND_TONES: Record<ContextEdge["kind"], string> = {
  explicit: "border-[hsl(var(--color-feedback-success)/0.22)] bg-[hsl(var(--color-feedback-success)/0.1)] text-[hsl(var(--color-feedback-success))]",
  source: "border-primary/20 bg-primary/10 text-primary",
  mention: "border-[hsl(var(--color-feedback-info)/0.22)] bg-[hsl(var(--color-feedback-info)/0.1)] text-[hsl(var(--color-feedback-info))]",
  inferred: "border-[hsl(var(--color-feedback-warning)/0.24)] bg-[hsl(var(--color-feedback-warning)/0.1)] text-[hsl(var(--color-feedback-warning))]",
  semantic: "border-white/10 bg-white/6 text-muted-foreground",
};

export function RelationKindBadge({ kind, className }: { kind: ContextEdge["kind"]; className?: string }) {
  return (
    <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]", KIND_TONES[kind], className)}>
      {KIND_LABELS[kind]}
    </span>
  );
}

export function RelationEvidenceCard({ edge, className }: { edge: ContextEdge; className?: string }) {
  return (
    <section className={cn("rounded-md border border-white/10 bg-black/10 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-primary">{displayRelationLabel(edge.label)}</p>
          <p className="mt-1 text-xs text-muted-foreground">신뢰도 {(edge.confidence * 100).toFixed(0)}%</p>
        </div>
        <RelationKindBadge kind={edge.kind} />
      </div>

      <div className="mt-3 grid gap-2">
        {edge.evidence.map((item, index) => (
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs" key={`${edge.id}:${index}`}>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span className="font-medium uppercase tracking-[0.12em] text-foreground">{displayEvidenceSource(item.source)}</span>
              {item.table ? <span>{displayEvidenceTable(item.table)}</span> : null}
              {item.propertyName ? <span>{item.propertyName}</span> : null}
            </div>
            {item.snippet ? <p className="mt-1 line-clamp-2 text-muted-foreground">{item.snippet}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function displayRelationLabel(label: string) {
  const labels: Record<string, string> = {
    asset: "자산",
    career: "커리어",
    daily_entry: "개별 기록",
    daily_log: "하루",
    "daily context query": "하루 맥락",
    "due date": "마감일",
    "gift person": "선물 대상",
    gift: "선물",
    interaction: "상호작용",
    "linked note": "연결 지식",
    "linked person": "연결 사람",
    media: "미디어",
    "contains task": "포함 작업",
    outgoing: "나가는 링크",
    backlink: "역링크",
    person: "사람",
    place: "장소",
    project: "프로젝트",
    "record review": "레코드 검토",
    "record trace": "레코드 추적",
    source_document: "원본 문서",
    tag: "태그",
    task: "작업",
    workout: "운동",
    zettel: "지식",
  };
  return labels[label] ?? label;
}

function displayEvidenceSource(source: ContextEdge["evidence"][number]["source"]) {
  if (source === "source_document") return "원본";
  if (source === "editor") return "편집기";
  if (source === "search") return "검색";
  if (source === "table") return "테이블";
  return source.toUpperCase();
}

function displayEvidenceTable(table: string) {
  const labels: Record<string, string> = {
    daily_log_people_relations: "하루-사람 연결",
    "gifts.person_id": "선물 대상",
    media_people_relations: "미디어-사람 연결",
    migration_review_items: "마이그레이션 검토",
    "tasks.project_id": "프로젝트 작업",
    task_people_relations: "작업-사람 연결",
    task_zettel_relations: "작업-지식 연결",
    zettel_links: "지식 링크",
    zettel_media_relations: "지식-미디어 연결",
    zettel_people_relations: "지식-사람 연결",
    zettels: "지식",
  };
  if (labels[table]) return labels[table];
  return table
    .replaceAll("source_document", "원본")
    .replaceAll("migration_review", "마이그레이션 검토")
    .replaceAll("source_documents", "원본");
}
