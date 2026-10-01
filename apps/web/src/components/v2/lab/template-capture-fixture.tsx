"use client";

import { Lightbulb, Send } from "lucide-react";
import { useState } from "react";

import { initialTemplateInputs, TemplateAssistPanel, type CaptureTemplateOption } from "@/components/v2/template-assist-panel";
import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";
import type { TemplateInputSubmission } from "@/lib/v2/templates/template-definition-v1";

const templates: readonly CaptureTemplateOption[] = SYSTEM_TEMPLATE_SEEDS.map((seed, index) => ({
  id: `fixture-template-${seed.key}`,
  name: seed.definition.name,
  description: seed.definition.description ?? null,
  iconKey: seed.iconKey,
  status: "active",
  currentVersionId: `fixture-version-${index + 1}`,
  pinned: false,
  definition: seed.definition,
}));

export function TemplateCaptureFixture() {
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CaptureTemplateOption | null>(null);
  const [inputs, setInputs] = useState<readonly TemplateInputSubmission[]>([]);
  function choose(template: CaptureTemplateOption | null) {
    setSelected(template);
    if (template) setInputs(initialTemplateInputs(template.definition));
  }
  return <main className="v2-product-shell v2-template-fixture"><div className={`v2-capture-layout${open ? " has-assist" : ""}`}><section className="v2-product-card"><header className="v2-product-heading"><div><p>자유 기록</p><h1>먼저 남겨두세요.</h1></div><span className="v2-product-local-state">새 기록</span></header><button aria-expanded={open} className="v2-template-launcher" onClick={() => setOpen(true)} type="button"><Lightbulb aria-hidden="true" size={16} />{selected ? `${selected.name} 도움 사용 중` : "도움받아 쓰기"}</button><label className="v2-product-field"><span className="sr-only">기록 본문</span><textarea autoFocus onChange={(event) => setBody(event.target.value)} placeholder="무엇이든 쓰세요. 분류는 나중에 합니다." value={body} /></label><footer className="v2-product-footer"><p>템플릿을 열지 않아도 저장할 수 있습니다.</p><button className="v2-product-primary" type="button"><Send aria-hidden="true" size={16} /> 원본 저장</button></footer></section>{open ? <TemplateAssistPanel inputs={inputs} loading={false} onAppendRecall={(answer) => setBody((current) => `${current}${current.trim() ? "\n\n" : ""}${answer}`)} onClose={() => setOpen(false)} onInputsChange={setInputs} onSelect={choose} selected={selected} templates={templates} /> : null}</div></main>;
}
