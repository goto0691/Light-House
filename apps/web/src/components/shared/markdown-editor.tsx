"use client";

import { useState } from "react";
import { Bold, Eye, Heading2, Italic, List, PencilLine, Quote, type LucideIcon } from "lucide-react";

import { MarkdownView } from "@/components/shared/markdown-view";
import { ZenEditor } from "@/components/shared/zen-editor";

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

function wrapSelection(value: string, prefix: string, suffix = prefix) {
  return `${value}${value.endsWith("\n") || !value ? "" : "\n"}${prefix}텍스트${suffix}`;
}

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const [mode, setMode] = useState<"edit" | "preview" | "split">("split");

  const tools: Array<{ label: string; icon: LucideIcon; apply: () => void }> = [
    { label: "H2", icon: Heading2, apply: () => onChange(`${value}${value.endsWith("\n") || !value ? "" : "\n"}## 제목`) },
    { label: "Bold", icon: Bold, apply: () => onChange(wrapSelection(value, "**")) },
    { label: "Italic", icon: Italic, apply: () => onChange(wrapSelection(value, "*")) },
    { label: "List", icon: List, apply: () => onChange(`${value}${value.endsWith("\n") || !value ? "" : "\n"}- 항목`) },
    { label: "Quote", icon: Quote, apply: () => onChange(`${value}${value.endsWith("\n") || !value ? "" : "\n"}> 인용`) },
  ];

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/10 text-muted-foreground transition hover:bg-white/8 hover:text-foreground" key={tool.label} onClick={tool.apply} title={tool.label} type="button">
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
        <div className="flex rounded-lg border border-white/10 bg-black/10 p-1">
          {([
            ["edit", PencilLine],
            ["split", Eye],
            ["preview", Eye],
          ] as Array<["edit" | "preview" | "split", LucideIcon]>).map(([key, Icon]) => (
            <button className={`h-9 rounded-md px-3 text-xs uppercase tracking-[0.14em] ${mode === key ? "bg-primary/12 text-primary" : "text-muted-foreground"}`} key={key} onClick={() => setMode(key)} type="button">
              <Icon className="mr-1 inline h-3.5 w-3.5" />
              {key}
            </button>
          ))}
        </div>
      </div>
      <div className={mode === "split" ? "grid gap-4 xl:grid-cols-2" : "space-y-4"}>
        {mode !== "preview" ? <ZenEditor onChange={onChange} placeholder="Markdown으로 작성하세요. @사람, [[지식]], #태그도 바로 연결됩니다." serif value={value} /> : null}
        {mode !== "edit" ? (
          <div className="min-h-[520px] rounded-lg border border-white/10 bg-black/10 p-6 md:p-8">
            <MarkdownView value={value} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
