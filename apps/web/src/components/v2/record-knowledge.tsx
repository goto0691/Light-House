"use client";

import { Check, ChevronRight, CircleAlert, LockKeyhole, Quote, Star, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PresentedField, PresentedReviewItem, RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";
import { SemanticIcon } from "@/components/v2/semantic-icon";
import { RecordContextModules } from "@/components/v2/record-context-modules";
import { fieldInputValue, parseFieldCorrection, ratingDisplayValue } from "@/lib/v2/presentation/field-input";

function valueText(field: PresentedField) {
  if (field.value === null || field.value === undefined) return "값 없음";
  if (field.renderer === "rating") return ratingDisplayValue(field.value);
  if (field.renderer === "boolean") return field.value ? "예" : "아니요";
  if (field.renderer === "date" && typeof field.value === "string") {
    const date = new Date(field.value);
    return Number.isNaN(date.valueOf()) ? field.value : date.toLocaleDateString("ko-KR");
  }
  if (typeof field.value === "object") return JSON.stringify(field.value);
  return String(field.value);
}

function Origin({ field }: { field: PresentedField }) {
  return <span className="v2-origin" data-origin={field.sourceClass}>{field.lockedByUser ? <LockKeyhole aria-hidden="true" size={11} /> : null}{field.sourceLabel}</span>;
}

function sourceHref(sourceItemId: string, sourceRecordId?: string) {
  const anchor = `#source-${encodeURIComponent(sourceItemId)}`;
  return sourceRecordId ? `/v2/records/${encodeURIComponent(sourceRecordId)}${anchor}` : anchor;
}

function Evidence({ field, sourceRecordId }: { field: PresentedField; sourceRecordId?: string }) {
  if (!field.evidence.length) return null;
  return (
    <details className="v2-field-evidence">
      <summary><Quote aria-hidden="true" size={12} /> 근거 {field.evidence.length}개</summary>
      <ul>{field.evidence.map((evidence) => {
        const externalUrl = typeof evidence.locator.url === "string" && evidence.locator.url.startsWith("https://") ? evidence.locator.url : null;
        return <li key={evidence.evidenceId}>
          {evidence.quote ? <q>{evidence.quote}</q> : <span>{externalUrl ? "검증된 외부 출처" : `${evidence.locatorKind} 근거`}</span>}
          {evidence.sourceItemId ? <a href={sourceHref(evidence.sourceItemId, sourceRecordId)}>원본 위치로</a> : externalUrl ? <a href={externalUrl} rel="noreferrer" target="_blank">외부 출처 열기</a> : null}
        </li>;
      })}</ul>
    </details>
  );
}

function FieldValue({ field, compact = false, anchorable = false, sourceRecordId }: { field: PresentedField; compact?: boolean; anchorable?: boolean; sourceRecordId?: string }) {
  return (
    <div className={compact ? "v2-presented-field is-highlight" : "v2-presented-field"} data-review-status={field.reviewStatus} id={anchorable ? `field-${field.propertyId}` : undefined} tabIndex={anchorable ? -1 : undefined}>
      <div className="v2-presented-field__label"><span>{field.label}</span>{field.reviewStatus === "proposed" ? <em>확인 필요</em> : field.reviewStatus === "disputed" ? <em>서로 다른 근거</em> : null}</div>
      <strong>{field.renderer === "rating" ? <Star aria-hidden="true" size={15} /> : null}{valueText(field)}</strong>
      {!compact ? <><Origin field={field} /><Evidence field={field} sourceRecordId={sourceRecordId} /></> : null}
    </div>
  );
}

function reviewTitle(item: PresentedReviewItem) {
  if (item.kind === "high_risk_claim") return "사람과 관계에 대한 해석을 확인해주세요";
  if (item.kind === "value_conflict") return "서로 다른 값이 있습니다";
  if (item.kind === "registry_conflict") return "분류 의미를 확인해주세요";
  if (item.kind === "analysis_warning") return "정리 과정의 주의사항";
  return item.field ? `${item.field.label} 값을 확인해주세요` : "확인할 내용이 있습니다";
}

function reviewDescription(item: PresentedReviewItem) {
  const message = typeof item.payload.message === "string" ? item.payload.message : null;
  const key = typeof item.payload.key === "string" ? item.payload.key : null;
  if (message) return message;
  if (key) return `새 분류 후보: ${key}`;
  if (typeof item.payload.mention === "string") return `언급된 대상: ${item.payload.mention}`;
  if (typeof item.payload.eventTypeKey === "string") return `기록에서 찾은 사건: ${item.payload.eventTypeKey}`;
  return "원본은 그대로 유지됩니다. 이 제안을 검토 목록에서 숨길 수 있습니다.";
}

function ReviewCard({ item, sourceRecordId }: { item: PresentedReviewItem; sourceRecordId?: string }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [correctedValue, setCorrectedValue] = useState(item.field ? fieldInputValue(item.field) : "");
  const actionable = Boolean(item.field || item.payload.entityTempId || item.payload.eventTempId || item.payload.target === "type");

  function parsedCorrection() {
    if (!item.field) return undefined;
    return parseFieldCorrection(item.field.renderer, correctedValue);
  }

  async function resolve(action: "accept" | "reject" | "correct" | "dismiss") {
    setBusy(true); setError(null);
    try {
      const correction = action === "correct" ? parsedCorrection() : undefined;
      if (action === "correct" && (correction === "" || (typeof correction === "number" && !Number.isFinite(correction)))) throw new Error("정정할 값을 입력해주세요.");
      const response = await fetch(`/api/v2/review-items/${item.reviewId}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmHighRisk: confirmed, correctedValue: correction }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "검토 결과를 저장하지 못했습니다.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "검토 결과를 저장하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <article className="v2-review-card">
      <header><CircleAlert aria-hidden="true" size={18} /><div><h3>{reviewTitle(item)}</h3><p>{item.requiresHighRiskConfirmation ? "AI 해석은 사실로 확정하지 않았습니다." : "원본과 기존 값을 보존한 채 선택할 수 있습니다."}</p></div></header>
      {item.field ? <FieldValue anchorable field={item.field} sourceRecordId={sourceRecordId} /> : <p className="v2-review-description">{reviewDescription(item)}</p>}
      {item.requiresHighRiskConfirmation ? <label className="v2-review-confirm"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /> 이 해석을 내 기록에 보관한다는 뜻을 이해했습니다.</label> : null}
      {editing && item.field ? <div className="v2-review-correction">
        <label htmlFor={`correction-${item.reviewId}`}>내 값으로 정정</label>
        {item.field.renderer === "boolean" ? <select id={`correction-${item.reviewId}`} onChange={(event) => setCorrectedValue(event.target.value)} value={correctedValue}><option value="true">예</option><option value="false">아니요</option></select>
          : <input id={`correction-${item.reviewId}`} inputMode={item.field.renderer === "number" || item.field.renderer === "rating" ? "decimal" : undefined} onChange={(event) => setCorrectedValue(event.target.value)} type={item.field.renderer === "date" ? "date" : item.field.renderer === "number" || item.field.renderer === "rating" ? "number" : "text"} value={correctedValue} />}
        <button disabled={busy} onClick={() => void resolve("correct")} type="button">정정값 저장</button>
      </div> : null}
      {error ? <p className="v2-product-error" role="alert">{error}</p> : null}
      <footer>
        {actionable ? <button disabled={busy} onClick={() => void resolve("reject")} type="button"><X aria-hidden="true" size={14} /> 보관하지 않기</button> : null}
        <button disabled={busy} onClick={() => void resolve("dismiss")} type="button">검토 목록에서 숨기기</button>
        {item.field ? <button aria-expanded={editing} disabled={busy} onClick={() => setEditing((current) => !current)} type="button">표현 수정</button> : null}
        {actionable ? <button className="is-primary" disabled={busy || (item.requiresHighRiskConfirmation && !confirmed)} onClick={() => void resolve("accept")} type="button"><Check aria-hidden="true" size={14} /> 내 기록으로 확인</button> : null}
      </footer>
    </article>
  );
}

export function RecordTypeBadge({ presentation }: { presentation: Pick<RecordKnowledgePresentation, "displayType"> }) {
  return <span className="v2-record-type"><SemanticIcon context="type" iconKey={presentation.displayType.iconKey} size={14} /><span>{presentation.displayType.label}</span>{presentation.displayType.tentative ? <em>새 분류</em> : null}</span>;
}

export function RecordKnowledge(props: ({ presentation: RecordKnowledgePresentation } | { presentationJson: string }) & { sourceRecordId?: string }) {
  // Server callers serialize only the already-authorized projection. Flight's
  // object decoder drops own __proto__ keys; a JSON string preserves these user
  // data keys for both generic fields and optional modules, without executing them.
  const presentation = "presentationJson" in props ? JSON.parse(props.presentationJson) as RecordKnowledgePresentation : props.presentation;
  const sourceRecordId = props.sourceRecordId;
  const ModuleField = ({ field }: { field: PresentedField }) => <FieldValue field={field} sourceRecordId={sourceRecordId} />;
  return (
    <>
      {presentation.highlights.length ? <section aria-label="주요 정보" className="v2-highlight-strip">{presentation.highlights.map((field) => <FieldValue compact field={field} key={field.propertyId} />)}</section> : null}
      {presentation.sections.map((section) => <section aria-labelledby={`knowledge-${section.key}`} className="v2-knowledge-section" key={section.key}>
        <h2 id={`knowledge-${section.key}`}>{section.title}</h2>
        <div>{section.fields.map((field) => <FieldValue anchorable field={field} key={field.propertyId} sourceRecordId={sourceRecordId} />)}</div>
      </section>)}
      <RecordContextModules modules={presentation.modules} Field={ModuleField} />
      {presentation.connections.length ? <section aria-labelledby="connections-heading" className="v2-connections"><h2 id="connections-heading">연결</h2><ul>{presentation.connections.map((connection) => <li key={connection.relationId}><span><small>{connection.predicateLabel}</small><strong>{connection.targetLabel}</strong><em>{connection.sourceLabel}</em></span>{connection.evidence[0]?.sourceItemId ? <a href={sourceHref(connection.evidence[0].sourceItemId, sourceRecordId)}>근거 보기</a> : null}</li>)}</ul></section> : null}
      {presentation.reviewItems.length ? <section aria-labelledby="review-heading" className="v2-review-section"><header><div><p>AI가 원본과 분리해 두었습니다</p><h2 id="review-heading">확인할 내용 {presentation.reviewItems.length}개</h2></div><ChevronRight aria-hidden="true" size={18} /></header><div>{presentation.reviewItems.map((item) => <ReviewCard item={item} key={item.reviewId} sourceRecordId={sourceRecordId} />)}</div></section> : null}
    </>
  );
}
