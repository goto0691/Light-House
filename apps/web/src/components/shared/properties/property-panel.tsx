"use client";

import { useId, useMemo, useState, type ReactNode } from "react";

import { GlassCard } from "@/components/shared/glass-card";
import type { PropertyDefinition, PropertyGroupDefinition, PropertyOption } from "@/lib/properties/types";
import { COMMON_PROPERTY_GROUPS } from "@/lib/properties/types";
import { cn } from "@/lib/utils/cn";

type PropertyFieldRuntimeOptions = {
  suggestions?: string[];
  options?: PropertyOption[];
  chipPrefix?: string;
  stripHash?: boolean;
};

type PropertyPanelProps<TForm extends object> = {
  definitions: PropertyDefinition[];
  form: TForm;
  onChange: (patch: Partial<TForm>) => void;
  className?: string;
  fieldOptions?: Record<string, PropertyFieldRuntimeOptions>;
  groups?: PropertyGroupDefinition[];
  title?: string;
};

export function PropertyPanel<TForm extends object>({
  className,
  definitions,
  fieldOptions,
  form,
  groups,
  onChange,
  title = "속성",
}: PropertyPanelProps<TForm>) {
  const groupDefinitions = groups ?? COMMON_PROPERTY_GROUPS;
  const definitionsByGroup = useMemo(() => {
    const map = new Map<string, PropertyDefinition[]>();
    for (const definition of definitions) {
      const items = map.get(definition.group) ?? [];
      items.push(definition);
      map.set(definition.group, items);
    }
    return map;
  }, [definitions]);

  return (
    <GlassCard className={cn("space-y-4", className)} priority="secondary">
      <div>
        <p className="text-xs tracking-[0.08em] text-primary">{title}</p>
      </div>

      {groupDefinitions.map((group) => {
        const groupDefinitions = definitionsByGroup.get(group.key) ?? [];
        if (!groupDefinitions.length) return null;
        return (
          <PropertySection defaultOpen={group.defaultOpen ?? true} description={group.description} key={group.key} title={group.label}>
            {groupDefinitions.map((definition) => (
              <PropertyField
                definition={definition}
                form={form}
                key={definition.key}
                onChange={onChange}
                runtimeOptions={fieldOptions?.[definition.field]}
              />
            ))}
          </PropertySection>
        );
      })}
    </GlassCard>
  );
}

function PropertySection({
  children,
  defaultOpen,
  description,
  title,
}: {
  children: ReactNode;
  defaultOpen: boolean;
  description?: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details className="rounded-lg border border-white/10 bg-black/10 p-4" onToggle={(event) => setOpen(event.currentTarget.open)} open={open}>
      <summary className="cursor-pointer list-none text-xs tracking-[0.08em] text-muted-foreground">
        <span>{title}</span>
        {description ? <span className="ml-2 text-[11px] text-muted-foreground/70">{description}</span> : null}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

function PropertyField<TForm extends object>({
  definition,
  form,
  onChange,
  runtimeOptions,
}: {
  definition: PropertyDefinition;
  form: TForm;
  onChange: (patch: Partial<TForm>) => void;
  runtimeOptions?: PropertyFieldRuntimeOptions;
}) {
  const datalistId = useId();
  const value = (form as Record<string, unknown>)[definition.field];
  const options = runtimeOptions?.options ?? definition.options ?? [];

  function patch(nextValue: unknown) {
    onChange({ [definition.field]: nextValue } as Partial<TForm>);
  }

  return (
    <div className="block">
      <p className="mb-2 text-[11px] tracking-[0.08em] text-muted-foreground">{definition.label}</p>
      {renderField({
        datalistId,
        definition,
        onChange: patch,
        options,
        runtimeOptions,
        value,
      })}
      {definition.description ? <span className="mt-1 block text-[11px] leading-5 text-muted-foreground/80">{definition.description}</span> : null}
    </div>
  );
}

function renderField({
  datalistId,
  definition,
  onChange,
  options,
  runtimeOptions,
  value,
}: {
  datalistId: string;
  definition: PropertyDefinition;
  onChange: (value: unknown) => void;
  options: PropertyOption[];
  runtimeOptions?: PropertyFieldRuntimeOptions;
  value: unknown;
}) {
  const display = definition.display ?? displayFromValueType(definition.valueType);

  if (display === "segmented") {
    return <SegmentedButtons onChange={onChange} options={options} value={asString(value)} />;
  }

  if (display === "select") {
    return (
      <select aria-label={definition.label} className="input-base" onChange={(event) => onChange(event.target.value)} value={asString(value)}>
        {definition.allowEmpty ? <option value="">미지정</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (display === "chip") {
    return (
      <ChipInput
        onChange={(items) => onChange(items)}
        placeholder={definition.placeholder ?? definition.label}
        prefix={runtimeOptions?.chipPrefix}
        stripHash={runtimeOptions?.stripHash}
        value={asStringArray(value)}
      />
    );
  }

  if (display === "date") {
    return <input aria-label={definition.label} className="input-base" onChange={(event) => onChange(event.target.value)} type="date" value={getDateInputValue(asString(value))} />;
  }

  if (display === "url") {
    return (
      <input
        className="input-base"
        aria-label={definition.label}
        inputMode="url"
        onChange={(event) => onChange(event.target.value)}
        placeholder={definition.placeholder}
        type="url"
        value={asString(value)}
      />
    );
  }

  if (display === "number") {
    return (
      <input
        className="input-base"
        aria-label={definition.label}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        placeholder={definition.placeholder}
        type="number"
        value={asString(value)}
      />
    );
  }

  if (display === "checkbox") {
    return (
      <span className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 text-sm text-foreground">
        <input checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
        {definition.placeholder ?? "사용"}
      </span>
    );
  }

  if (display === "textarea") {
    return (
      <textarea
        className="input-base min-h-28 resize-y leading-6"
        aria-label={definition.label}
        onChange={(event) => onChange(event.target.value)}
        placeholder={definition.placeholder}
        value={asString(value)}
      />
    );
  }

  return (
    <>
      <input
        className="input-base"
        aria-label={definition.label}
        list={runtimeOptions?.suggestions?.length ? datalistId : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={definition.placeholder}
        value={asString(value)}
      />
      {runtimeOptions?.suggestions?.length ? (
        <datalist id={datalistId}>
          {runtimeOptions.suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

function SegmentedButtons({ onChange, options, value }: { onChange: (value: string) => void; options: PropertyOption[]; value: string }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-white/10 bg-black/10 p-1">
      {options.map((option) => (
        <button
          className={cn(
            "focus-ring min-h-9 rounded px-2.5 text-xs transition",
            value === option.value ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/8 hover:text-foreground",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ChipInput({
  onChange,
  placeholder,
  prefix = "",
  stripHash = false,
  value,
}: {
  onChange: (value: string[]) => void;
  placeholder: string;
  prefix?: string;
  stripHash?: boolean;
  value: string[];
}) {
  const [draft, setDraft] = useState("");

  function addValues(input: string) {
    const nextValues = input
      .split(/[,\n]/)
      .map((item) => {
        const next = item.trim().replace(/\s+/g, " ");
        return stripHash ? next.replace(/^#/, "") : next;
      })
      .filter(Boolean);
    if (!nextValues.length) return;
    const unique = new Map(value.map((item) => [item.toLowerCase(), item]));
    nextValues.forEach((item) => unique.set(item.toLowerCase(), item.slice(0, 80)));
    onChange([...unique.values()]);
    setDraft("");
  }

  return (
    <div className="min-h-11 rounded-md border border-white/10 bg-black/10 px-2 py-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((item) => (
          <button
            className="focus-ring rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] text-primary"
            key={item}
            onClick={() => onChange(value.filter((valueItem) => valueItem !== item))}
            type="button"
          >
            {prefix}
            {item}
          </button>
        ))}
        <input
          className="min-h-7 min-w-28 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onBlur={() => addValues(draft)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            addValues(draft);
          }}
          placeholder={placeholder}
          value={draft}
        />
      </div>
    </div>
  );
}

function displayFromValueType(valueType: PropertyDefinition["valueType"]) {
  if (valueType === "longText") return "textarea";
  if (valueType === "multiSelect") return "chip";
  if (valueType === "boolean") return "checkbox";
  if (valueType === "url") return "url";
  if (valueType === "date") return "date";
  if (valueType === "number") return "number";
  if (valueType === "select") return "select";
  return "text";
}

function asString(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getDateInputValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}
