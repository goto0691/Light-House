"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink } from "lucide-react";

import { GlassCard } from "@/components/shared/glass-card";
import type { PropertyDefinition } from "@/lib/properties/types";
import { classifySourcePropertyWithMappingRules } from "@/lib/source-property-mapping-rules";
import { useSourcePropertyMappingRules } from "@/lib/source-property-mapping-client";
import type { SourcePropertyClassification } from "@/lib/properties/source-mapping";
import type { SourcePropertyMappingRule } from "@/lib/source-workbench-types";
import { cn } from "@/lib/utils/cn";

export type SourceProperty = {
  name: string;
  value: string;
  type?: string | null;
};

export type SourceRecordInfo = {
  id: string;
  sourceDatabase: string | null;
  sourceId: string;
  documentRole: string | null;
  status: string;
  url?: string | null;
  preview: string | null;
  properties: SourceProperty[];
};

export type SourcePropertyTarget<TForm extends object> = {
  value: string;
  label: string;
  apply?: (input: { form: TForm; sourceDocument: SourceRecordInfo; value: string }) => Partial<TForm>;
};

type SourcePropertyInspectorProps<TForm extends object> = {
  form: TForm;
  onChange: (patch: Partial<TForm>) => void;
  sourceDocument?: SourceRecordInfo | null;
  targets: Array<SourcePropertyTarget<TForm>>;
  canonicalEntityType?: string | null;
  definitions?: PropertyDefinition[];
  compact?: boolean;
  emptyMessage?: string;
  formatType?: (type: string) => string;
  getDisplayName?: (property: SourceProperty) => string;
  guessTarget?: (property: SourceProperty, sourceDocument: SourceRecordInfo) => string;
  mappingRules?: SourcePropertyMappingRule[];
  title?: string;
};

export function SourcePropertyInspector<TForm extends object>({
  canonicalEntityType,
  compact = false,
  definitions = [],
  emptyMessage = "가져온 원본 문서는 있지만 노출된 속성은 없습니다.",
  form,
  formatType = defaultFormatPropertyType,
  getDisplayName,
  guessTarget,
  onChange,
  sourceDocument,
  targets,
  title = "가져온 속성",
  mappingRules,
}: SourcePropertyInspectorProps<TForm>) {
  const document = sourceDocument ?? null;
  const visibleProperties = useMemo(() => document?.properties.filter((property) => property.value.trim()) ?? [], [document]);
  const [targetOverrides, setTargetOverrides] = useState<Record<string, string>>({});
  const fetchedMappingRules = useSourcePropertyMappingRules(Boolean(document) && mappingRules === undefined);
  const activeMappingRules = mappingRules ?? fetchedMappingRules;
  if (!document) return null;
  const activeDocument: SourceRecordInfo = document;

  const targetMap = new Map(targets.map((target) => [target.value, target]));
  const targetValues = targets.map((target) => target.value);

  function targetFor(property: SourceProperty) {
    const key = propertyKey(property);
    return targetOverrides[key] ?? guessTarget?.(property, activeDocument) ?? mappedClassificationFor(property).targetValue;
  }

  function propertyClassification(property: SourceProperty): SourcePropertyClassification {
    const key = propertyKey(property);
    const registryClassification = mappedClassificationFor(property);
    const guessedTarget = guessTarget?.(property, activeDocument);
    const targetValue = targetOverrides[key] ?? guessedTarget ?? registryClassification.targetValue;
    const displayName = getDisplayName?.(property) ?? registryClassification.displayName;

    if (targetValue !== "skip") {
      return {
        ...registryClassification,
        status: "suggested",
        displayName,
        targetValue,
        reason: registryClassification.status === "hidden" ? "숨김 후보지만 사용자가 매핑 대상으로 선택했습니다." : registryClassification.reason,
      };
    }

    return {
      ...registryClassification,
      displayName: registryClassification.displayName === property.name ? displayName : registryClassification.displayName,
      targetValue,
    };
  }

  function mappedClassificationFor(property: SourceProperty) {
    return classifySourcePropertyWithMappingRules(property, definitions, activeMappingRules, {
      canonicalEntityType,
      sourceDatabase: activeDocument.sourceDatabase,
      targetValues,
    }).classification;
  }

  function applyProperty(property: SourceProperty) {
    const targetValue = targetFor(property);
    const target = targetMap.get(targetValue);
    const value = property.value.trim();
    if (!value || !target?.apply) return;
    onChange(target.apply({ form, sourceDocument: activeDocument, value }));
  }

  const propertyRows = visibleProperties.map((property) => ({
    key: propertyKey(property),
    property,
    classification: propertyClassification(property),
  }));
  const groupedRows = [
    {
      key: "suggested",
      title: "적용 후보",
      description: "속성 별칭이나 사용자가 고른 대상과 연결된 원본 속성입니다.",
      rows: propertyRows.filter((row) => row.classification.status === "suggested"),
    },
    {
      key: "unmapped",
      title: "검토 필요",
      description: "아직 표준 속성으로 연결되지 않은 원본 속성입니다.",
      rows: propertyRows.filter((row) => row.classification.status === "unmapped"),
    },
    {
      key: "hidden",
      title: "숨김/노이즈",
      description: "원본에는 보존하지만 일반 속성 편집에서는 낮은 우선순위로 둡니다.",
      rows: propertyRows.filter((row) => row.classification.status === "hidden"),
    },
  ];

  return (
    <GlassCard priority="secondary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-primary">{title}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {activeDocument.sourceDatabase ?? "원본 레코드"} · {translateStatus(activeDocument.status)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeDocument.url ? (
            <a
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground"
              href={activeDocument.url}
              rel="noreferrer"
              target="_blank"
              title="원본 열기"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] text-muted-foreground">
            속성 {visibleProperties.length}개
          </span>
        </div>
      </div>

      {activeDocument.preview ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">{activeDocument.preview}</p> : null}

      {visibleProperties.length ? (
        <div className="mt-4 grid gap-3">
          {groupedRows.map((group) => {
            if (!group.rows.length) return null;
            const content = (
              <div className="mt-2 grid gap-2">
                {group.rows.map((row) => (
                  <SourcePropertyRow
                    classification={row.classification}
                    compact={compact}
                    formatType={formatType}
                    key={row.key}
                    onApply={() => applyProperty(row.property)}
                    onTargetChange={(value) => setTargetOverrides((current) => ({ ...current, [row.key]: value }))}
                    property={row.property}
                    target={targetMap.get(targetFor(row.property))}
                    targets={targets}
                    targetValue={targetFor(row.property)}
                  />
                ))}
              </div>
            );

            if (group.key === "hidden") {
              return (
                <details className="rounded-md border border-white/10 bg-black/10 p-3" key={group.key}>
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    {group.title} {group.rows.length}개
                  </summary>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground/80">{group.description}</p>
                  {content}
                </details>
              );
            }

            return (
              <section className="rounded-md border border-white/10 bg-black/10 p-3" key={group.key}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{group.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground/80">{group.description}</p>
                  </div>
                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">{group.rows.length}</span>
                </div>
                {content}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-white/15 bg-black/10 p-3 text-sm text-muted-foreground">{emptyMessage}</p>
      )}
    </GlassCard>
  );
}

function SourcePropertyRow<TForm extends object>({
  classification,
  compact,
  formatType,
  onApply,
  onTargetChange,
  property,
  target,
  targets,
  targetValue,
}: {
  classification: SourcePropertyClassification;
  compact: boolean;
  formatType: (type: string) => string;
  onApply: () => void;
  onTargetChange: (value: string) => void;
  property: SourceProperty;
  target?: SourcePropertyTarget<TForm>;
  targets: Array<SourcePropertyTarget<TForm>>;
  targetValue: string;
}) {
  const applicable = Boolean(target?.apply && property.value.trim());
  return (
    <div
      className={cn(
        "grid gap-3 rounded-md border border-white/10 bg-white/5 p-3",
        !compact && "lg:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1.4fr)_180px_96px]",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-muted-foreground">{classification.displayName}</p>
          {property.type ? <span className="text-[10px] text-muted-foreground/80">{formatType(property.type)}</span> : null}
        </div>
        {classification.displayName !== property.name ? <p className="mt-1 truncate text-[11px] text-muted-foreground/70">{property.name}</p> : null}
        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground/80">{classification.reason}</p>
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-[10px] text-muted-foreground/80">값</p>
        <p className="line-clamp-3 break-words text-sm text-foreground">{property.value}</p>
      </div>
      <select
        aria-label={`${classification.displayName} 매핑 대상`}
        className="input-base h-10 py-0 text-xs"
        onChange={(event) => onTargetChange(event.target.value)}
        value={targetValue}
      >
        {targets.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        className={cn(
          "focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50",
          applicable ? "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15" : "border-white/10 bg-white/5 text-muted-foreground",
          compact && "w-full",
        )}
        disabled={!applicable}
        onClick={onApply}
        type="button"
      >
        <Check className="h-4 w-4" />
        적용
      </button>
    </div>
  );
}

function propertyKey(property: SourceProperty) {
  return `${property.name}:${property.type ?? ""}:${property.value}`;
}

function translateStatus(status: string) {
  if (status === "mapped") return "매핑됨";
  if (status === "active") return "활성";
  if (status === "needs_review") return "검토 필요";
  if (status === "archived") return "보관";
  return status;
}

function defaultFormatPropertyType(type: string) {
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
