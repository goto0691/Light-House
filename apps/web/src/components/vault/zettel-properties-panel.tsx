"use client";

import { DOCUMENT_KIND_OPTIONS, type ZettelFormState, ZETTEL_STATUS_OPTIONS, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
import { GlassCard } from "@/components/shared/glass-card";
import { cn } from "@/lib/utils/cn";

type ZettelPropertiesPanelProps = {
  form: ZettelFormState;
  onChange: (patch: Partial<ZettelFormState>) => void;
  className?: string;
};

export function ZettelPropertiesPanel({ form, onChange, className }: ZettelPropertiesPanelProps) {
  return (
    <GlassCard className={cn("space-y-4", className)} priority="secondary">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Properties</p>
        <p className="mt-2 text-sm text-muted-foreground">읽기 흐름에서 숨겨졌던 Zettel 속성을 작성 흐름 안에서 바로 채웁니다.</p>
      </div>

      <PropertySection title="기본 정보">
        <Field label="Type">
          <select className="input-base" onChange={(event) => onChange({ type: event.target.value as ZettelFormState["type"] })} value={form.type}>
            {ZETTEL_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Document Kind">
          <select className="input-base" onChange={(event) => onChange({ documentKind: event.target.value })} value={form.documentKind}>
            <option value="">Not set</option>
            {DOCUMENT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <input className="input-base" onChange={(event) => onChange({ category: event.target.value })} placeholder="신앙/종교, 창작, 문서 아카이브..." value={form.category} />
        </Field>
        <Field label="Status">
          <select className="input-base" onChange={(event) => onChange({ status: event.target.value })} value={form.status}>
            <option value="">Not set</option>
            {ZETTEL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </PropertySection>

      <PropertySection title="요약">
        <Field label="Summary">
          <textarea
            className="input-base min-h-28 resize-y leading-6"
            onChange={(event) => onChange({ summary: event.target.value })}
            placeholder="목록과 읽기 화면에 표시할 짧은 요약"
            value={form.summary}
          />
        </Field>
      </PropertySection>

      <PropertySection title="출처">
        <Field label="Source">
          <input className="input-base" onChange={(event) => onChange({ source: event.target.value })} placeholder="Notion, 설교 노트, 개인 기록..." value={form.source} />
        </Field>
        <Field label="Source URL">
          <input className="input-base" inputMode="url" onChange={(event) => onChange({ sourceUrl: event.target.value })} placeholder="https://..." value={form.sourceUrl} />
        </Field>
        <Field label="Original Created At">
          <input className="input-base" onChange={(event) => onChange({ originalCreatedAt: event.target.value })} type="date" value={form.originalCreatedAt} />
        </Field>
      </PropertySection>
    </GlassCard>
  );
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
