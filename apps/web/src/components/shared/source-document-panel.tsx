"use client";

import { useMemo } from "react";

import { Tag } from "@/components/shared/tag";
import type { SourceDocumentInfo } from "@/lib/mock/vault";
import { ALL_PROPERTY_DEFINITIONS, propertyDefinitionsFor } from "@/lib/properties/registry";
import { classifySourcePropertyWithMappingRules } from "@/lib/source-property-mapping-rules";
import { useSourcePropertyMappingRules } from "@/lib/source-property-mapping-client";
import type { PropertyDefinition, PropertyEntityType } from "@/lib/properties/types";
import type { SourcePropertyClassification } from "@/lib/properties/source-mapping";

type SourceDocumentPanelProps = {
  sourceDocument?: SourceDocumentInfo | null;
  canonicalEntityType?: string | null;
  definitions?: PropertyDefinition[];
};

type ClassifiedSourceProperty = {
  key: string;
  name: string;
  type?: string | null;
  value: string;
  classification: SourcePropertyClassification;
};

const PROPERTY_ENTITY_TYPES = [
  "zettel",
  "media",
  "person",
  "daily_log",
  "daily_log_entry",
  "project",
  "task",
  "habit",
  "workout",
  "career",
  "asset",
  "place",
  "gift",
] as const satisfies readonly PropertyEntityType[];
const PROPERTY_ENTITY_TYPE_SET = new Set<string>(PROPERTY_ENTITY_TYPES);

export function SourceDocumentPanel({ canonicalEntityType, definitions, sourceDocument }: SourceDocumentPanelProps) {
  const mappingRules = useSourcePropertyMappingRules(Boolean(sourceDocument));
  const sourceDefinitions = useMemo(
    () => definitions ?? definitionsForEntity(canonicalEntityType),
    [canonicalEntityType, definitions],
  );
  const rows = useMemo<ClassifiedSourceProperty[]>(
    () =>
      sourceDocument?.properties
        .filter((property) => property.value?.trim())
        .map((property) => ({
          key: `${property.name}:${property.type ?? ""}:${property.value}`,
          name: property.name,
          type: property.type,
          value: property.value,
          classification: classifySourcePropertyWithMappingRules(property, sourceDefinitions, mappingRules, {
            canonicalEntityType,
            sourceDatabase: sourceDocument.sourceDatabase,
          }).classification,
        })) ?? [],
    [canonicalEntityType, mappingRules, sourceDefinitions, sourceDocument],
  );

  if (!sourceDocument) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-primary">원본 속성</p>
        <p className="mt-3 text-sm text-muted-foreground">연결된 속성 정보가 아직 없습니다.</p>
      </section>
    );
  }

  const groupedRows = [
    {
      key: "suggested",
      title: "적용 후보",
      rows: rows.filter((row) => row.classification.status === "suggested"),
    },
    {
      key: "unmapped",
      title: "검토 필요",
      rows: rows.filter((row) => row.classification.status === "unmapped"),
    },
    {
      key: "hidden",
      title: "숨김/노이즈",
      rows: rows.filter((row) => row.classification.status === "hidden"),
    },
  ];

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-primary">원본 속성</p>
          <h3 className="mt-2 text-lg font-medium text-foreground">{sourceDocument.sourceDatabase ?? "연결된 레코드"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">전역 원본 컬럼 규칙과 registry 판정을 함께 반영합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sourceDocument.documentRole ? <Tag value={sourceDocument.documentRole} variant="neutral" /> : null}
          <Tag value={translateStatus(sourceDocument.status)} variant="neutral" />
        </div>
      </div>

      {sourceDocument.preview ? <p className="mt-4 line-clamp-4 text-sm leading-6 text-muted-foreground">{sourceDocument.preview}</p> : null}

      {rows.length ? (
        <div className="mt-4 grid gap-3">
          {groupedRows.map((group) => {
            if (!group.rows.length) return null;
            if (group.key === "hidden") {
              return (
                <details className="rounded-md border border-white/10 bg-black/10 p-3" key={group.key}>
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    {group.title} · {group.rows.length}개
                  </summary>
                  <div className="mt-3 grid gap-2">
                    {group.rows.map((row) => (
                      <PropertyRow key={row.key} row={row} />
                    ))}
                  </div>
                </details>
              );
            }

            return (
              <section className="rounded-md border border-white/10 bg-black/10 p-3" key={group.key}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{group.title}</p>
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">{group.rows.length}</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {group.rows.map((row) => (
                    <PropertyRow key={row.key} row={row} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function PropertyRow({ row }: { row: ClassifiedSourceProperty }) {
  return (
    <div className="grid gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs sm:grid-cols-[minmax(140px,0.7fr)_minmax(0,1fr)]">
      <span className="min-w-0 text-muted-foreground">
        <span className="block truncate text-foreground">{row.classification.displayName}</span>
        {row.classification.displayName !== row.name ? <span className="mt-1 block truncate text-[11px]">{row.name}</span> : null}
        {row.type ? <span className="mt-1 block text-[11px] text-muted-foreground/70">{formatPropertyType(row.type)}</span> : null}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-foreground">{row.value}</span>
        <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-muted-foreground/80">{row.classification.reason}</span>
      </span>
    </div>
  );
}

function definitionsForEntity(entityType: string | null | undefined) {
  const normalized = entityType === "daily_entry" ? "daily_log_entry" : entityType;
  if (normalized && PROPERTY_ENTITY_TYPE_SET.has(normalized)) {
    return propertyDefinitionsFor(normalized as PropertyEntityType);
  }
  return ALL_PROPERTY_DEFINITIONS;
}

function translateStatus(status: string) {
  if (status === "mapped") return "매핑됨";
  if (status === "active") return "활성";
  if (status === "needs_review") return "검토 필요";
  if (status === "archived") return "보관";
  return status;
}

function formatPropertyType(type: string) {
  const normalized = type.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
  if (normalized.includes("multi")) return "다중 선택";
  if (normalized.includes("select")) return "선택";
  if (normalized.includes("date")) return "날짜";
  if (normalized.includes("url")) return "URL";
  if (normalized.includes("checkbox") || normalized.includes("boolean")) return "체크";
  if (normalized.includes("number")) return "숫자";
  if (normalized.includes("title")) return "제목";
  if (normalized.includes("text") || normalized.includes("rich")) return "텍스트";
  return type;
}
