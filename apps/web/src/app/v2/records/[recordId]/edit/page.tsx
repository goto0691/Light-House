import { notFound } from "next/navigation";

import { DocumentEditor } from "@/components/v2/editor/document-editor";
import { EditorRecoveryPolicy } from "@/components/v2/editor/editor-recovery-policy";
import { RestrictedUnlock } from "@/components/v2/restricted-unlock";
import { getSession } from "@/lib/auth/session";
import { getActiveRestrictedGrant, hasUnexpiredRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import "../../../../v2-lab/v2-lab.css";
import "../../../v2-product.css";

export const dynamic = "force-dynamic";

export default async function V2EditRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const flags = getV2ServerFeatureFlags();
  if (!flags.routes) notFound();
  const session = await getSession();
  if (!session) notFound();
  const { recordId } = await params;
  const db = getV2CloudflareBindings().db;
  const grant = await getActiveRestrictedGrant(db, { userId: session.userId, sessionId: session.sessionId });
  const record = await new D1SourceFoundationRepository(db, session.userId).getRecord(recordId, Boolean(grant));
  if (!record) notFound();
  const recoveryPolicy = await new D1SourceFoundationRepository(db, session.userId).getRecoveryPolicy(recordId);
  if (!recoveryPolicy || recoveryPolicy.privacyLevel !== record.privacyLevel
    || (!record.locked && recoveryPolicy.currentVersion !== record.currentVersion)) notFound();
  if (!record.locked && recoveryPolicy.privacyLevel === "restricted" && !hasUnexpiredRestrictedGrant(grant)) notFound();
  if (record.locked) return <main className="v2-product-shell"><EditorRecoveryPolicy ownerId={session.userId} {...recoveryPolicy} /><div className="v2-product-card"><RestrictedUnlock /></div></main>;
  return (
    <main className="v2-lab v2-product-editor">
      <EditorRecoveryPolicy ownerId={session.userId} {...recoveryPolicy} />
      <DocumentEditor ownerId={session.userId} initial={{
        recordId: record.recordId,
        title: record.title ?? "제목 없는 기록",
        bodyMarkdown: record.bodyMarkdown ?? "",
        currentRevisionId: record.currentRevisionId ?? "",
        currentVersion: record.currentVersion ?? 1,
        writtenAt: record.writtenAt,
        documentStatus: record.documentStatus ?? "inbox",
        privacyLevel: record.privacyLevel,
        sourceCount: record.sources.length,
      }} writeEnabled={flags.write} />
    </main>
  );
}
