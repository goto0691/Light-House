import { NotebookTabs } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SemanticIcon } from "@/components/v2/semantic-icon";
import { TemplateActions } from "@/components/v2/template-actions";
import { requireSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import "../../v2-product.css";

export const metadata = { title: "입력 템플릿 · Light House" };
export const dynamic = "force-dynamic";

function statusLabel(status: string) {
  return status === "generated_draft" ? "자동 초안" : status === "suggested" ? "제안" : status === "trial" ? "시험 사용" : status === "active" ? "사용 중" : "초안";
}

export default async function V2TemplatesPage() {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession();
  const repository = new D1TemplateRepository(getV2CloudflareBindings().db, session.userId);
  await repository.ensureSystemSeeds();
  const templates = await repository.list();
  const automatic = templates.filter((template) => template.status === "generated_draft" || template.status === "suggested");
  const available = templates.filter((template) => !["generated_draft", "suggested"].includes(template.status));
  return <main className="v2-product-shell"><nav className="v2-product-nav"><Link href="/v2/library"><strong>Light House</strong></Link><Link href="/v2/capture">새 기록</Link></nav><section className="v2-product-card v2-template-library"><header><p>기억을 꺼내는 선택적 단서</p><h1>입력 템플릿</h1><span>빈 기록은 언제나 기본 경로입니다.</span></header>{automatic.length ? <section><h2>자동 초안</h2><p>서로 다른 날짜의 반복 구조에서 만들었습니다. 선택하기 전에는 입력 메뉴에 나타나지 않습니다.</p><div className="v2-template-grid">{automatic.map((template) => <article key={template.id}><Link href={`/v2/library/templates/${template.id}`}><span><SemanticIcon context="template" iconKey={template.iconKey} size={20} /></span><div><small>{statusLabel(template.status)}</small><h3>{template.name}</h3><p>{template.description}</p></div></Link><TemplateActions compact origin={template.origin} pinned={template.pinned} status={template.status} templateId={template.id} templateVersionId={template.currentVersionId} /></article>)}</div></section> : null}<section><h2>사용 가능한 템플릿</h2><p>사용자가 직접 선택한 경우에만 캡처 화면의 입력 구조가 바뀝니다.</p>{available.length ? <div className="v2-template-grid">{available.map((template) => <article key={template.id}><Link href={`/v2/library/templates/${template.id}`}><span><SemanticIcon context="template" iconKey={template.iconKey} size={20} /></span><div><small>{statusLabel(template.status)}</small><h3>{template.name}</h3><p>{template.description}</p></div></Link><TemplateActions compact origin={template.origin} pinned={template.pinned} status={template.status} templateId={template.id} templateVersionId={template.currentVersionId} /></article>)}</div> : <div className="v2-review-empty"><NotebookTabs aria-hidden="true" size={30} /><h2>사용할 템플릿이 없습니다.</h2><p>자유 기록은 템플릿 없이 계속 사용할 수 있습니다.</p></div>}</section></section></main>;
}
