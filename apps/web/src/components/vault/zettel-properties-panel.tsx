"use client";

import { useState } from "react";

import {
  DOCUMENT_KIND_OPTIONS,
  type ZettelFormState,
  ZETTEL_REVIEW_CADENCE_OPTIONS,
  ZETTEL_SOURCE_RELIABILITY_OPTIONS,
  ZETTEL_STATUS_OPTIONS,
  ZETTEL_TYPE_OPTIONS,
} from "@/components/vault/zettel-form";
import { GlassCard } from "@/components/shared/glass-card";
import { cn } from "@/lib/utils/cn";

type ZettelPropertiesPanelProps = {
  form: ZettelFormState;
  onChange: (patch: Partial<ZettelFormState>) => void;
  categoryOptions?: string[];
  className?: string;
};

export function ZettelPropertiesPanel({ form, onChange, categoryOptions = [], className }: ZettelPropertiesPanelProps) {
  return (
    <GlassCard className={cn("space-y-4", className)} priority="secondary">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Properties</p>
      </div>

      <PropertySection title="분류">
        <Field label="메모 타입">
          <SegmentedButtons
            options={ZETTEL_TYPE_OPTIONS}
            value={form.type}
            onChange={(value) => onChange({ type: value as ZettelFormState["type"] })}
          />
        </Field>
        <Field label="문서 종류">
          <select className="input-base" onChange={(event) => onChange({ documentKind: event.target.value })} value={form.documentKind}>
            <option value="">미지정</option>
            {DOCUMENT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="상태">
          <SegmentedButtons options={ZETTEL_STATUS_OPTIONS} value={form.status} onChange={(value) => onChange({ status: value })} />
        </Field>
      </PropertySection>

      <PropertySection title="회수 단서">
        <Field label="카테고리">
          <input
            className="input-base"
            list={categoryOptions.length ? "zettel-category-options" : undefined}
            onChange={(event) => onChange({ category: event.target.value })}
            placeholder="신앙/종교, 창작, 문서 아카이브..."
            value={form.category}
          />
          {categoryOptions.length ? (
            <datalist id="zettel-category-options">
              {categoryOptions.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          ) : null}
        </Field>
        <Field label="태그">
          <ChipInput onChange={(tags) => onChange({ tags })} placeholder="태그" prefix="#" stripHash value={form.tags} />
        </Field>
        <Field label="별칭">
          <ChipInput onChange={(aliases) => onChange({ aliases })} placeholder="별칭" value={form.aliases} />
        </Field>
      </PropertySection>

      <PropertySection title="검토">
        <Field label="출처 신뢰도">
          <select className="input-base" onChange={(event) => onChange({ sourceReliability: event.target.value })} value={form.sourceReliability}>
            {ZETTEL_SOURCE_RELIABILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="검토 주기">
          <select className="input-base" onChange={(event) => onChange({ reviewCadence: event.target.value })} value={form.reviewCadence}>
            {ZETTEL_REVIEW_CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="다음 검토일">
          <input className="input-base" onChange={(event) => onChange({ reviewDueAt: event.target.value })} type="date" value={getDateInputValue(form.reviewDueAt)} />
        </Field>
      </PropertySection>

      <details className="rounded-lg border border-white/10 bg-black/10 p-4">
        <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-muted-foreground">출처</summary>
        <div className="mt-3 space-y-3">
          <Field label="출처">
            <input className="input-base" onChange={(event) => onChange({ source: event.target.value })} placeholder="Notion, 설교 노트, 개인 기록..." value={form.source} />
          </Field>
          <Field label="출처 URL">
            <input className="input-base" inputMode="url" onChange={(event) => onChange({ sourceUrl: event.target.value })} placeholder="https://..." type="url" value={form.sourceUrl} />
          </Field>
          <Field label="원본 생성일">
            <input
              className="input-base"
              onChange={(event) => onChange({ originalCreatedAt: event.target.value })}
              type="date"
              value={getDateInputValue(form.originalCreatedAt)}
            />
          </Field>
        </div>
      </details>
    </GlassCard>
  );
}

function SegmentedButtons({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
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

function getDateInputValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function PropertySection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/10 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
