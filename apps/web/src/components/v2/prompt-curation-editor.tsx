"use client";

import { useEffect, useRef, useState } from "react";
import type { PromptCurationContent } from "@/lib/v2/domain/prompt-curation-request";
import type { PromptCopyRole } from "@/lib/v2/domain/prompt-curation-v1";

export const curationRoles = { prompt: "프롬프트", negative_prompt: "네거티브 프롬프트", parameters: "설정값" } as const;
const completenessLabels: Record<string, string> = { complete: "선택한 원문 범위 확보", partial: "일부 원문 확보", truncated: "잘린 원문", ocr_unverified: "OCR 미확인", selection_unverified: "선택 범위 미검증", unknown: "전체 범위 미확인" };
export type CurationCandidate = { id: string; snapshotId: string; memberId: string; rawText: string; role: PromptCopyRole;
  stateVersion: number; origin: "manual" | "ai" | "stored"; isManual?: boolean; completeness: string; sourceItemId?: string; sourceUrl?: string };
export type CurationImage = { key: string; memberId: string; attachmentId: string; filename: string };
export type CurationBasis = { expectedRevisionId: string; expectedSnapshotId: string; expectedManifestHash: string };
export type CurationDraft = { basis: CurationBasis; groupKey: string; head: { id: string; revisionNumber: number } | null;
  content: PromptCurationContent; originals: CurationCandidate[]; dirty: boolean; conflict: boolean };

function reorder(items: PromptCurationContent["items"]) {
  const positions = { prompt: 0, negative_prompt: 0, parameters: 0 };
  return items.map((item) => ({ ...item, position: positions[item.copyRole]++ }));
}

export function CurationImagePreview({ image }: { image: CurationImage }) {
  const [failed, setFailed] = useState(false), element = useRef<HTMLImageElement>(null);
  useEffect(() => { if (element.current?.complete && element.current.naturalWidth === 0) setFailed(true); }, []);
  const url = `/api/v2/attachments/${encodeURIComponent(image.attachmentId)}`;
  return <>{failed ? <p>보관 이미지를 표시할 수 없습니다. 연결 정보는 유지됩니다.</p>
    // Private attachment route performs the live access check; no external image fetch.
    // eslint-disable-next-line @next/next/no-img-element
    : <img ref={element} src={url} alt={`내가 연결한 예시 · ${image.filename}`} loading="lazy" onError={() => setFailed(true)} />}
    <a href={url} target="_blank" rel="noreferrer">보관 이미지 원본 열기 · {image.filename}</a></>;
}

export function PromptCurationEditor({ draft, candidates, images, disabled, onChange, onSave }: {
  draft: CurationDraft; candidates: CurationCandidate[]; images: CurationImage[]; disabled: boolean;
  onChange: (content: PromptCurationContent, originals?: CurationCandidate[]) => void; onSave: () => void;
}) {
  const [candidateId, setCandidateId] = useState(""), [imageKey, setImageKey] = useState(""), [target, setTarget] = useState("");
  const content = draft.content, selected = candidates.find((row) => row.id === candidateId);
  const full = content.items.length >= 64;
  function add(candidate: CurationCandidate) {
    if (full) return;
    onChange({ ...content, orderConfirmation: "unconfirmed", items: [...content.items, { itemKey: crypto.randomUUID(), fragmentId: candidate.id,
      expectedFragmentStateVersion: candidate.stateVersion, copyRole: candidate.role, position: content.items.filter((row) => row.copyRole === candidate.role).length }] },
    [...draft.originals.filter((row) => row.id !== candidate.id), candidate]);
  }
  function move(itemKey: string, direction: -1 | 1) {
    const items = [...content.items], index = items.findIndex((row) => row.itemKey === itemKey);
    const positions = items.map((row, i) => row.copyRole === items[index].copyRole ? i : -1).filter((i) => i >= 0);
    const next = positions[positions.indexOf(index) + direction]; if (next === undefined) return;
    [items[index], items[next]] = [items[next], items[index]]; onChange({ ...content, orderConfirmation: "unconfirmed", items: reorder(items) });
  }
  function remove(itemKey: string) {
    onChange({ ...content, orderConfirmation: "unconfirmed", items: reorder(content.items.filter((row) => row.itemKey !== itemKey)),
      examples: content.examples.filter((row) => row.itemKey !== itemKey).map((row, position) => ({ ...row, position })) });
  }
  function moveExample(index: number, direction: -1 | 1) {
    const examples = [...content.examples], next = index + direction; if (!examples[next]) return;
    [examples[index], examples[next]] = [examples[next], examples[index]];
    onChange({ ...content, examples: examples.map((row, position) => ({ ...row, position })) });
  }
  return <div className="v2-curation-editor" role="group" aria-label="정리본 편집기">
    <p className="v2-curation-note">원문은 바꾸지 않습니다. 기기 복구 상태는 위에서 확인하세요. 다른 정리본을 열면 현재 초안을 먼저 보존하며, 복구가 꺼졌거나 실패하면 전환을 멈춥니다.</p>
    <fieldset disabled={disabled}>
      <legend>{draft.head ? "저장 정리본 수정" : "새 정리본"}</legend>
      <div className="v2-curation-fields">
        <label>정리본 제목<input value={content.title} maxLength={200} onChange={(event) => onChange({ ...content, title: event.target.value })} /></label>
        <label>자료 관계<select value={content.relationKind} onChange={(event) => onChange({ ...content, relationKind: event.target.value as PromptCurationContent["relationKind"], relationshipConfirmation: "unconfirmed" })}>
          <option value="continuation">이어지는 조각</option><option value="collection">같은 자료 묶음</option><option value="alternatives">서로 다른 판본</option>
        </select></label>
      </div>
      <label className="v2-curation-check"><input type="checkbox" checked={content.relationshipConfirmation === "user_confirmed"} onChange={(event) => onChange({ ...content, relationshipConfirmation: event.target.checked ? "user_confirmed" : "unconfirmed" })} />이어지는 관계를 확인했습니다</label>
      <label className="v2-curation-check"><input type="checkbox" checked={content.orderConfirmation === "user_confirmed"} onChange={(event) => onChange({ ...content, orderConfirmation: event.target.checked ? "user_confirmed" : "unconfirmed" })} />조각 순서를 확인했습니다</label>
      <p>두 확인은 원문 전체 확보나 사실 검증을 뜻하지 않습니다. 자료 묶음·다른 판본은 이어 복사하지 않습니다.</p>
      <div className="v2-curation-fields"><label>추가할 원문 조각<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>
        <option value="">원문 조각 선택</option>{candidates.map((row, index) => <option value={row.id} key={row.id}>{index + 1}. {curationRoles[row.role]} · {row.origin === "manual" ? "내 발췌" : "AI 선택 원문"} · {row.rawText.slice(0, 65)}</option>)}
      </select></label><button disabled={!selected || full} onClick={() => selected && add(selected)} type="button">조각 추가</button></div>
      {selected ? <pre aria-label="추가할 조각 원문">{selected.rawText}</pre> : null}
      <p>{content.items.length}/64 조각 · 역할은 발췌 당시 값으로 고정됩니다. 역할 변경은 새 수동 발췌로 만드세요.</p>
      {Object.entries(curationRoles).map(([role, label]) => {
        const items = content.items.filter((item) => item.copyRole === role).sort((a, b) => a.position - b.position);
        return <section className="v2-curation-role" aria-label={`${label} 조각 정렬`} key={role}><h5>{label}</h5>
          {!items.length ? <p>선택한 조각이 없습니다.</p> : null}
          {items.map((item, index) => { const original = draft.originals.find((row) => row.id === item.fragmentId); const linked = content.examples.filter((row) => row.itemKey === item.itemKey).length;
            return <article key={item.itemKey} className="v2-curation-item" data-curation-item={item.itemKey}>
              <h6>{label} 조각 {index + 1}</h6><p>{original?.origin === "ai" ? "AI가 선택한 원문 · AI 해석 아님" : "보관 원문 조각"} · {completenessLabels[original?.completeness ?? "unknown"] ?? "범위 확인 필요"}</p>
              {original?.sourceItemId ? <p><a href={`#source-${encodeURIComponent(original.sourceItemId)}`}>보관 원문으로 이동</a>{original.sourceUrl ? <> · <a href={original.sourceUrl} target="_blank" rel="noreferrer">원문 출처 열기</a></> : null}</p> : null}
              {original ? <pre aria-label={`${label} 조각 ${index + 1} 원문`}>{original.rawText}</pre> : <p>이 조각의 보관 원문은 정리본 상세에서 확인하세요.</p>}
              <div className="v2-curation-actions">
                <button type="button" aria-label={`${label} 조각 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(item.itemKey, -1)}>위로</button>
                <button type="button" aria-label={`${label} 조각 ${index + 1} 아래로`} disabled={index === items.length - 1} onClick={() => move(item.itemKey, 1)}>아래로</button>
                <button type="button" aria-label={`${label} 조각 ${index + 1} 한 번 더 추가`} disabled={!original || full} onClick={() => original && add(original)}>한 번 더 추가</button>
                <button type="button" aria-label={`${label} 조각 ${index + 1} 삭제`} onClick={() => remove(item.itemKey)}>{linked ? `조각과 연결 예시 ${linked}개 삭제` : "조각 삭제"}</button>
              </div>
            </article>; })}
        </section>;
      })}
      <section className="v2-curation-role" aria-label="이미지 예시 연결"><h5>내가 연결한 예시</h5><p>실제 생성에 사용된 프롬프트라는 증명은 아닙니다. 같은 자료 버전에 보관된 전체 이미지만 연결합니다.</p>
        <div className="v2-curation-fields"><label>연결할 보관 이미지<select value={imageKey} onChange={(event) => setImageKey(event.target.value)}><option value="">이미지 선택</option>{images.map((image) => <option key={image.key} value={image.key}>{image.filename}</option>)}</select></label>
          <label>예시 연결 대상<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">{content.relationKind === "alternatives" ? "판본 조각 선택 필요" : "정리본 전체"}</option>{content.items.map((item) => <option key={item.itemKey} value={item.itemKey}>{curationRoles[item.copyRole]} 조각 {item.position + 1}</option>)}</select></label></div>
        <button type="button" disabled={!images.some((image) => image.key === imageKey) || content.examples.length >= 64 || content.relationKind === "alternatives" && !target || Boolean(target && !content.items.some((item) => item.itemKey === target))}
          onClick={() => { const image = images.find((row) => row.key === imageKey); if (image) onChange({ ...content, examples: [...content.examples, { exampleKey: crypto.randomUUID(), itemKey: target || null,
            memberId: image.memberId, attachmentId: image.attachmentId, position: content.examples.length, evidenceMethod: "unresolved" }] }); }}>이미지 예시 추가</button>
        <p>{content.examples.length}/64 예시{!images.length ? " · 현재 자료에 연결할 보관 이미지가 없습니다." : ""}</p>
        {content.examples.map((example, index) => { const image = images.find((row) => row.attachmentId === example.attachmentId && row.memberId === example.memberId); const item = content.items.find((row) => row.itemKey === example.itemKey);
          return <article className="v2-curation-example" key={example.exampleKey}>
            <p>예시 {index + 1} · {item ? `${curationRoles[item.copyRole]} 조각 ${item.position + 1}` : example.itemKey === null ? "정리본 전체" : "연결한 조각 확인 필요"}</p>
            {image ? <CurationImagePreview image={image} /> : <p>현재 목록에 없는 기존 이미지 연결 · 삭제하지 않고 유지합니다.</p>}
            {content.relationKind === "alternatives" && example.itemKey === null ? <p role="alert">다른 판본은 개별 조각에 이미지를 연결해야 합니다. 이 예시를 삭제하고 대상을 지정해 다시 추가해 주세요.</p> : null}
            <label className="v2-curation-check"><input type="checkbox" checked={example.evidenceMethod === "user_confirmed"} onChange={(event) => onChange({ ...content, examples: content.examples.map((row) => row.exampleKey === example.exampleKey ? { ...row, evidenceMethod: event.target.checked ? "user_confirmed" : "unresolved" } : row) })} />예시 {index + 1} 이미지 대응을 확인했습니다</label>
            <div className="v2-curation-actions"><button type="button" aria-label={`예시 ${index + 1} 위로`} disabled={index === 0} onClick={() => moveExample(index, -1)}>위로</button><button type="button" aria-label={`예시 ${index + 1} 아래로`} disabled={index === content.examples.length - 1} onClick={() => moveExample(index, 1)}>아래로</button>
              <button type="button" aria-label={`예시 ${index + 1} 삭제`} onClick={() => onChange({ ...content, examples: content.examples.filter((row) => row.exampleKey !== example.exampleKey).map((row, position) => ({ ...row, position })) })}>예시 삭제</button></div>
          </article>; })}
      </section>
      <button className="v2-curation-primary" type="button" disabled={!content.title.trim() || !content.items.length || content.relationKind === "alternatives" && content.examples.some((row) => row.itemKey === null)} onClick={onSave}>{draft.head ? "새 버전으로 저장" : "정리본 저장"}</button>
    </fieldset>
  </div>;
}
