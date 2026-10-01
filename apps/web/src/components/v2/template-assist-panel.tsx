"use client";

import { ChevronDown, Lightbulb, LockKeyhole, Star, X } from "lucide-react";
import { useState } from "react";

import { SemanticIcon } from "@/components/v2/semantic-icon";
import { itemValueKind, type TemplateBlankState, type TemplateDefinitionV1, type TemplateInputSubmission, type TemplateItemV1 } from "@/lib/v2/templates/template-definition-v1";

export type CaptureTemplateOption = Readonly<{
  id: string;
  name: string;
  description: string | null;
  iconKey: string;
  status: "draft" | "generated_draft" | "suggested" | "trial" | "active" | "dismissed" | "archived";
  currentVersionId: string;
  pinned: boolean;
  definition: TemplateDefinitionV1;
}>;

const BLANK_LABELS: Readonly<Record<TemplateBlankState, string>> = {
  answered: "답함",
  unanswered: "아직 답하지 않음",
  unknown: "모름",
  not_applicable: "해당 없음",
  withheld: "기록하지 않음",
};

function structuredItems(definition: TemplateDefinitionV1) {
  return definition.sections.flatMap((section) => section.items).filter((item) => !["recall_cue", "scaffold", "attachment"].includes(item.kind));
}

export function initialTemplateInputs(definition: TemplateDefinitionV1, now = new Date().toISOString()): TemplateInputSubmission[] {
  return structuredItems(definition).map((item, inputOrder) => ({ itemKey: item.key, valueKind: itemValueKind(item), value: null, blankState: "unanswered", inputOrder, clientTimestamp: now }));
}

function displayValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function TemplateInput({ item, input, onChange }: { item: TemplateItemV1; input: TemplateInputSubmission; onChange: (next: TemplateInputSubmission) => void }) {
  const disabled = input.blankState !== "answered" && input.blankState !== "unanswered";
  const controlId = `template-input-${item.key}`;
  const updateValue = (value: unknown, hasValue: boolean) => onChange({ ...input, value: hasValue ? value : null, blankState: hasValue ? "answered" : "unanswered", clientTimestamp: new Date().toISOString() });
  const control = item.inputKind === "rating" ? (
    <div className="v2-template-rating"><Star aria-hidden="true" size={17} /><select aria-label={item.prompt} disabled={disabled} id={controlId} onChange={(event) => updateValue(event.target.value ? Number(event.target.value) : null, Boolean(event.target.value))} value={input.blankState === "answered" ? String(input.value) : ""}><option value="">평점 선택</option>{Array.from({ length: 11 }, (_, index) => index / 2).map((rating) => <option key={rating} value={rating}>{rating.toFixed(1)} / 5</option>)}</select></div>
  ) : item.inputKind === "date" ? (
    <input aria-label={item.prompt} disabled={disabled} id={controlId} onChange={(event) => updateValue(event.target.value, Boolean(event.target.value))} type="date" value={input.blankState === "answered" ? displayValue(input.value) : ""} />
  ) : item.inputKind === "number" || item.inputKind === "measurement" ? (
    <input aria-label={item.prompt} disabled={disabled} id={controlId} inputMode="decimal" onChange={(event) => updateValue(event.target.value ? Number(event.target.value) : null, Boolean(event.target.value) && Number.isFinite(Number(event.target.value)))} type="number" value={input.blankState === "answered" ? displayValue(input.value) : ""} />
  ) : item.inputKind === "boolean" ? (
    <label className="v2-template-boolean"><input aria-label={item.prompt} checked={input.blankState === "answered" && input.value === true} disabled={disabled} id={controlId} onChange={(event) => updateValue(event.target.checked, true)} type="checkbox" /> 예</label>
  ) : (
    <input aria-label={item.prompt} disabled={disabled} id={controlId} onChange={(event) => {
      const text = event.target.value;
      updateValue(item.cardinality === "many" ? text.split(",").map((part) => part.trim()).filter(Boolean) : text, Boolean(text.trim()));
    }} placeholder={item.inputKind === "person_picker" ? "쉼표로 구분 · 비워도 됩니다" : "비워도 됩니다"} type="text" value={input.blankState === "answered" ? displayValue(input.value) : ""} />
  );
  return (
    <div className="v2-template-item">
      <label htmlFor={controlId}><strong>{item.prompt}</strong>{item.helperText ? <small>{item.helperText}</small> : null}</label>
      {control}
      <label className="v2-template-blank" htmlFor={`blank-${item.key}`}><span className="sr-only">{item.prompt}의 답변 상태</span><select id={`blank-${item.key}`} onChange={(event) => onChange({ ...input, value: null, blankState: event.target.value as TemplateBlankState, clientTimestamp: new Date().toISOString() })} value={input.blankState}>{Object.entries(BLANK_LABELS).filter(([state]) => state !== "answered" || input.blankState === "answered").map(([state, label]) => <option key={state} value={state}>{label}</option>)}</select><ChevronDown aria-hidden="true" size={13} /></label>
      {input.blankState === "withheld" ? <small className="v2-template-policy"><LockKeyhole aria-hidden="true" size={12} /> AI도 이 값을 추론하지 않습니다.</small> : input.blankState === "unanswered" && item.allowedAiOperations.some((operation) => operation !== "none") ? <small className="v2-template-policy">저장 후 현재 자료에 근거가 있을 때만 AI가 제안합니다.</small> : null}
    </div>
  );
}

export function TemplateAssistPanel({ templates, selected, inputs, loading, disabled = false, onClose, onSelect, onInputsChange, onAppendRecall }: {
  disabled?: boolean;
  templates: readonly CaptureTemplateOption[];
  selected: CaptureTemplateOption | null;
  inputs: readonly TemplateInputSubmission[];
  loading: boolean;
  onClose: () => void;
  onSelect: (template: CaptureTemplateOption | null) => void;
  onInputsChange: (inputs: readonly TemplateInputSubmission[]) => void;
  onAppendRecall: (answer: string) => void;
}) {
  const [activeCue, setActiveCue] = useState<string | null>(null);
  const [cueAnswer, setCueAnswer] = useState("");
  const inputByKey = new Map(inputs.map((input) => [input.itemKey, input]));
  const cues = selected?.definition.sections.flatMap((section) => section.items).filter((item) => item.kind === "recall_cue") ?? [];
  return (
    <aside aria-labelledby="template-assist-title" className="v2-template-assist" inert={disabled}>
      <header><div><p>선택적 입력 도움</p><h2 id="template-assist-title">{selected ? selected.name : "도움받아 쓰기"}</h2></div><button aria-label="도움 패널 닫기" onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button></header>
      {!selected ? (
        <div className="v2-template-picker">
          <p>글의 종류를 먼저 정하지 않아도 됩니다. 필요할 때만 기억 단서를 골라 쓰세요.</p>
          {loading ? <p role="status">템플릿을 불러오는 중…</p> : templates.length ? templates.map((template) => <button key={template.id} onClick={() => onSelect(template)} type="button"><SemanticIcon context="template" iconKey={template.iconKey} size={19} /><span><strong>{template.name}</strong><small>{template.description}</small></span></button>) : <p>사용할 수 있는 템플릿이 없습니다.</p>}
        </div>
      ) : (
        <>
          <div className="v2-template-selected"><SemanticIcon context="template" iconKey={selected.iconKey} size={18} /><span>{selected.status === "trial" ? "이번 기록에서 시험 사용 중" : "입력 도움 사용 중"}</span><button onClick={() => onSelect(null)} type="button">템플릿 해제</button></div>
          {selected.definition.sections.map((section) => {
            const items = section.items.filter((item) => inputByKey.has(item.key));
            return items.length ? <section className="v2-template-section" key={section.key}><h3>{section.label}</h3>{items.map((item) => <TemplateInput input={inputByKey.get(item.key) as TemplateInputSubmission} item={item} key={item.key} onChange={(next) => onInputsChange(inputs.map((input) => input.itemKey === next.itemKey ? next : input))} />)}</section> : null;
          })}
          {cues.length ? <section className="v2-template-cues"><h3><Lightbulb aria-hidden="true" size={15} /> 더 떠올려보기</h3>{cues.map((cue) => <button aria-pressed={activeCue === cue.key} key={cue.key} onClick={() => { setActiveCue(activeCue === cue.key ? null : cue.key); setCueAnswer(""); }} type="button">{cue.prompt}</button>)}{activeCue ? <div><label><span className="sr-only">떠오른 내용</span><textarea autoFocus onChange={(event) => setCueAnswer(event.target.value)} placeholder="질문은 저장하지 않고 답만 본문에 덧붙입니다." value={cueAnswer} /></label><button disabled={!cueAnswer.trim()} onClick={() => { onAppendRecall(cueAnswer.trim()); setCueAnswer(""); setActiveCue(null); }} type="button">본문에 덧붙이기</button></div> : null}</section> : null}
        </>
      )}
    </aside>
  );
}
