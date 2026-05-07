import type { ReactNode } from "react";

import type { PropertyDefinition, PropertyGroupDefinition } from "@/lib/properties/types";
import { COMMON_PROPERTY_GROUPS, optionLabel } from "@/lib/properties/types";
import { cn } from "@/lib/utils/cn";

type PropertySummaryMode = "list" | "detail" | "all";

type PropertySummaryProps = {
  definitions: PropertyDefinition[];
  record: object;
  className?: string;
  emptyMessage?: string;
  groups?: PropertyGroupDefinition[];
  mode?: PropertySummaryMode;
  showGroupLabels?: boolean;
  showTitle?: boolean;
  title?: string;
  valueOverrides?: Record<string, unknown>;
};

type VisibleProperty = {
  definition: PropertyDefinition;
  value: ReactNode;
};

export function PropertySummary({
  className,
  definitions,
  emptyMessage = "표시할 속성이 없습니다.",
  groups = COMMON_PROPERTY_GROUPS,
  mode = "detail",
  record,
  showGroupLabels = true,
  showTitle = true,
  title = "속성 요약",
  valueOverrides,
}: PropertySummaryProps) {
  const visibleProperties = definitions
    .filter((definition) => shouldShowDefinition(definition, mode))
    .map((definition) => ({
      definition,
      value: formatPropertyValue(definition, valueOverrides?.[definition.field] ?? (record as Record<string, unknown>)[definition.field]),
    }))
    .filter((item): item is VisibleProperty => item.value !== null);

  if (!visibleProperties.length) {
    return (
      <section className={cn("text-sm text-muted-foreground", className)}>
        {showTitle ? <p className="text-xs tracking-[0.08em] text-primary">{title}</p> : null}
        <p className={cn(showTitle && "mt-2")}>{emptyMessage}</p>
      </section>
    );
  }

  if (!showGroupLabels) {
    return (
      <section className={cn("space-y-2", className)}>
        {showTitle ? <p className="text-xs tracking-[0.08em] text-primary">{title}</p> : null}
        <dl className="divide-y divide-white/10 border-y border-white/10">
          {visibleProperties.map(({ definition, value }) => (
            <div className="grid gap-1 py-2 text-xs sm:grid-cols-[minmax(88px,0.45fr)_minmax(0,1fr)]" key={definition.key}>
              <dt className="text-muted-foreground">{definition.label}</dt>
              <dd className="min-w-0 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <section className={cn("space-y-4", className)}>
      {showTitle ? <p className="text-xs tracking-[0.08em] text-primary">{title}</p> : null}
      {groups.map((group) => {
        const properties = visibleProperties.filter((item) => item.definition.group === group.key);
        if (!properties.length) return null;
        return (
          <div className="space-y-2" key={group.key}>
            <p className="text-[11px] tracking-[0.08em] text-muted-foreground">{group.label}</p>
            <dl className="divide-y divide-white/10 border-y border-white/10">
              {properties.map(({ definition, value }) => (
                <div className="grid gap-1 py-2 text-xs sm:grid-cols-[minmax(88px,0.45fr)_minmax(0,1fr)]" key={definition.key}>
                  <dt className="text-muted-foreground">{definition.label}</dt>
                  <dd className="min-w-0 break-words text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </section>
  );
}

function shouldShowDefinition(definition: PropertyDefinition, mode: PropertySummaryMode) {
  if (mode === "all") return true;
  if (mode === "list") return Boolean(definition.defaultVisibleInList);
  return Boolean(definition.defaultVisibleInDetail);
}

function formatPropertyValue(definition: PropertyDefinition, value: unknown): ReactNode | null {
  if (isEmptyValue(value)) return null;

  if (Array.isArray(value)) {
    const labels = value.map((item) => formatScalarValue(definition, item)).filter(Boolean);
    return labels.length ? labels.join(", ") : null;
  }

  if (typeof value === "boolean") {
    return value ? "예" : "아니오";
  }

  return formatScalarValue(definition, value);
}

function formatScalarValue(definition: PropertyDefinition, value: unknown) {
  if (isEmptyValue(value)) return null;
  const text = String(value).trim();
  if (!text || text === "-") return null;
  if (definition.options?.length) return optionLabel(definition.options, text, text);
  if (definition.valueType === "date" && /^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return !value.trim() || value.trim() === "-";
  return false;
}
