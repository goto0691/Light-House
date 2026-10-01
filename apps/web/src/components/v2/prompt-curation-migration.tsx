"use client";

import { useState } from "react";
import { CurationImagePreview, curationRoles } from "@/components/v2/prompt-curation-editor";
import type { LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import type { PromptCurationMigrationPlan } from "@/lib/v2/domain/prompt-curation-migration";
import type { StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";

const issues = { same_snapshot: "이미 같은 자료 버전입니다", missing: "대응하는 원문 또는 이미지 없음", changed: "같은 이름의 원문이 변경됨",
  ambiguous: "대응 후보가 여러 개임", range_changed: "선택 범위의 원문이 변경됨", coverage_changed: "원문 확보 상태가 달라짐" };

export function PromptCurationMigration({ source, target, plan, busy, conflict, attempted, saved, onSave, onRecheck, onClose, onOpenSnapshot }: {
  source: StoredPromptCuration; target: LinkPresentationV1; plan: PromptCurationMigrationPlan; busy: boolean; conflict: boolean;
  attempted: boolean; saved: StoredPromptCuration | null; onSave: () => void; onRecheck: () => void; onClose: () => void; onOpenSnapshot?: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return <section className="v2-curation-migration" aria-label="현재 자료로 가져오기 확인">
    <h4>현재 자료로 가져오기</h4>
    <p><strong>{source.title}</strong> · 정리본 버전 {source.revisionNumber} → 자료 버전 {target.selectedSnapshot?.snapshotVersion}의 새 정리본</p>
    {target.currentSnapshotId !== plan.expectedSnapshotId || target.currentRevisionId !== plan.expectedRevisionId
      ? <p className="v2-curation-warning">복구한 이관의 대상은 현재 최신 버전과 다릅니다. 최초 요청을 그대로 확인하며, 이미 저장된 요청만 재생됩니다. 저장되지 않은 이전 요청은 충돌로 남고 자동으로 최신 자료에 적용하지 않습니다.</p> : null}
    <p>원래 정리본과 이력은 그대로 두고, 선택한 원문 범위와 이미지 연결을 새 그룹의 첫 버전으로 저장합니다. 역할·순서·의도적인 중복도 유지합니다.</p>
    <details><summary>원본과 대상 식별 정보</summary><dl>
      <dt>원본 자료</dt><dd>{source.snapshotId}</dd><dt>원본 정리본 버전</dt><dd>{source.id}</dd>
      <dt>대상 자료</dt><dd>{plan.expectedSnapshotId}</dd><dt>대상 본문 버전</dt><dd>{plan.expectedRevisionId}</dd>
    </dl></details>
    {Object.entries(curationRoles).map(([role, label]) => <section key={role} aria-label={`${label} 이관 대응`}>
      <h5>{label}</h5>{source.items.filter((item) => item.copyRole === role).sort((a, b) => a.position - b.position).map((item) => {
        const mapping = plan.items.find((row) => row.itemKey === item.itemKey), issue = plan.issues.find((row) => row.kind === "item" && row.key === item.itemKey);
        const member = target.members.find((row) => row.memberId === mapping?.memberId);
        return <div className="v2-curation-item" key={item.itemKey}>
          <p>{label} 조각 {item.position + 1} · {mapping ? "정확한 원문 대응 확인" : issue ? issues[issue.reason] : "대응 확인 필요"}</p>
          <pre tabIndex={0} aria-label={`${label} 이관 원문 ${item.position + 1}`}>{item.fragment.rawText}</pre>
          {mapping ? <p className="v2-curation-note">대상 자료 {member?.memberKey} · 원문 위치 {item.fragment.textStart}–{item.fragment.textEnd} · {mapping.match === "member_key" ? "같은 자료 키와 지문" : "유일한 동일 자료 지문"}</p> : null}
          {plan.selectionConfirmations.includes(item.itemKey) ? <p className="v2-curation-warning">AI가 선택했던 범위입니다. 아래 확인은 이 범위를 내가 선택한 원문으로 보관한다는 뜻입니다.</p> : null}
        </div>;
      })}
    </section>)}
    {source.content.examples.length ? <section aria-label="이관할 예시 이미지"><h5>예시 이미지</h5>{source.content.examples.map((example, index) => {
      const mapping = plan.examples.find((row) => row.exampleKey === example.exampleKey), issue = plan.issues.find((row) => row.kind === "example" && row.key === example.exampleKey);
      const member = target.members.find((row) => row.memberId === mapping?.memberId), attachment = member?.attachments.find((row) => row.id === mapping?.attachmentId);
      const item = source.content.items.find((row) => row.itemKey === example.itemKey);
      return <div className="v2-curation-example" key={example.exampleKey}>
        <p>예시 {index + 1} · {item ? `${curationRoles[item.copyRole]} 조각 ${item.position + 1}` : "정리본 전체"} · {mapping ? "이미지 전체 해시·형식·크기 일치" : issue ? issues[issue.reason] : "대응 확인 필요"}</p>
        <p>{example.evidenceMethod === "user_confirmed" ? "사용자 대응 확인 유지" : "이미지 대응 미확인 유지"}</p>
        {mapping && attachment ? <CurationImagePreview image={{ key: example.exampleKey, memberId: mapping.memberId, attachmentId: mapping.attachmentId, filename: attachment.filename }} /> : null}
      </div>;
    })}</section> : null}
    <p className="v2-curation-warning">이관은 외부 원문의 완전성이나 사실을 검증하지 않습니다. 부분 원문·OCR 미확인·전체 파트 수 미상 등 기존 경고는 유지합니다.</p>
    {!plan.ready ? <p role="status">이관할 수 없는 항목이 {plan.issues.length}개 있습니다. 일부만 저장하지 않습니다. 필요한 자료를 보강하거나 별도 정리본을 만들어 주세요.</p> : null}
    {conflict ? <p role="status">확인 이후 저장 상태가 달라졌습니다. 미리보기를 다시 읽고 직접 확인해야 합니다. 자동으로 재이관하지 않습니다.</p> : null}
    {saved ? <p role="status">자료 버전 {target.selectedSnapshot?.snapshotVersion}에 새 정리본을 저장했습니다. 원본 버전 {source.revisionNumber}은 유지했습니다.</p> : <label className="v2-curation-check">
      <input type="checkbox" checked={confirmed} disabled={busy || !plan.ready || conflict} onChange={(event) => setConfirmed(event.target.checked)} />
      원문 범위와 이미지 대응을 검토했고 새 정리본으로 보관합니다{plan.selectionConfirmations.length ? " (AI 선택 범위 포함)" : ""}
    </label>}
    <div className="v2-curation-actions">
      {!saved ? <button type="button" className="v2-curation-primary" disabled={busy || !confirmed || !plan.ready || conflict} onClick={onSave}>{attempted ? "같은 이관 요청 다시 시도" : "확인한 내용으로 새 정리본 저장"}</button> : null}
      {!saved ? <button type="button" disabled={busy} onClick={onRecheck}>이관 미리보기 다시 확인</button> : null}
      {saved && onOpenSnapshot ? <button type="button" disabled={busy} onClick={onOpenSnapshot}>저장된 자료 버전 열기</button> : null}
      <button type="button" disabled={busy} onClick={onClose}>{saved ? "이관 확인 닫기" : attempted ? "이관 확인 닫기 · 저장 목록에서 결과 확인" : "이관 취소"}</button>
    </div>
    {attempted && !saved ? <p className="v2-curation-note">응답을 받지 못해도 저장됐을 수 있습니다. 재시도는 같은 요청 키를 사용합니다. 미리보기를 새로 시작하기 전 대상 자료의 정리본 목록을 확인하세요.</p> : null}
  </section>;
}
