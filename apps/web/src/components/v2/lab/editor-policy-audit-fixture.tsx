import { DocumentEditor } from "@/components/v2/editor/document-editor";
import { EditorRecoveryPolicy } from "@/components/v2/editor/editor-recovery-policy";

export function EditorPolicyAuditFixture({ state }: { state: "normal" | "locked" | "returned" }) {
  const privacyLevel = state === "locked" ? "restricted" : "normal";
  const currentVersion = state === "normal" ? 1 : state === "locked" ? 2 : 3;
  return <main className="v2-lab v2-product-editor">
    <p>합성 편집 복구 정책 검증 · 운영 기록과 실제 서버 저장을 사용하지 않습니다.</p>
    <EditorRecoveryPolicy currentVersion={currentVersion} ownerId="policy-audit-owner" privacyLevel={privacyLevel} recordId="policy-audit-record" />
    {state === "locked" ? <section className="v2-record-locked"><h1>합성 잠금 기록</h1><p>기록 본문은 전달하지 않고 개인정보 정책만 적용합니다.</p></section>
      : <DocumentEditor ownerId="policy-audit-owner" initial={{ recordId: "policy-audit-record", title: "합성 정책 검증 문서", bodyMarkdown: "합성 문서입니다.", currentRevisionId: `policy-revision-${currentVersion}`, currentVersion, writtenAt: null, documentStatus: "draft", privacyLevel, sourceCount: 0 }} writeEnabled />}
  </main>;
}
