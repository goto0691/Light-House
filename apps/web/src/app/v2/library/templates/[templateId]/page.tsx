import Link from "next/link";
import { notFound } from "next/navigation";

import { SemanticIcon } from "@/components/v2/semantic-icon";
import { TemplateActions } from "@/components/v2/template-actions";
import { requireSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import "../../../v2-product.css";

export const dynamic = "force-dynamic";

export default async function V2TemplateDetailPage({ params }: { params: Promise<{ templateId: string }> }) {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession();
  const template = await new D1TemplateRepository(getV2CloudflareBindings().db, session.userId).get((await params).templateId);
  if (!template) notFound();
  return <main className="v2-product-shell"><nav className="v2-product-nav"><Link href="/v2/library/templates"><strong>입력 템플릿</strong></Link><Link href="/v2/library">보관함</Link></nav><article className="v2-product-card v2-template-detail"><header><span><SemanticIcon context="template" iconKey={template.iconKey} size={25} /></span><div><p>{template.status === "generated_draft" ? "자동 생성된 비활성 초안" : `버전 ${template.versionNumber}`}</p><h1>{template.name}</h1><small>{template.description}</small></div></header><p className="v2-template-detail__principle">질문에 모두 답할 필요가 없습니다. 템플릿은 기록 유형을 강제하지 않으며 본문을 대신 쓰지 않습니다.</p>{template.definition.sections.map((section) => <section key={section.key}><h2>{section.label}</h2><ol>{section.items.map((item) => <li key={item.key}><div><strong>{item.prompt}</strong>{item.helperText ? <small>{item.helperText}</small> : null}</div><span>{item.kind === "recall_cue" ? "떠올림 단서" : item.prominence === "core" ? "먼저" : item.prominence === "suggested" ? "생각해볼 것" : "선택 사항"}</span></li>)}</ol></section>)}<footer><TemplateActions origin={template.origin} pinned={template.pinned} status={template.status} templateId={template.id} templateVersionId={template.currentVersionId} /></footer></article></main>;
}
