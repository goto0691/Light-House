import Link from "next/link";
import { notFound } from "next/navigation";

import { RediscoveryControls } from "@/components/v2/rediscovery-controls";
import { RediscoveryDeck } from "@/components/v2/rediscovery-deck";
import { requireSession } from "@/lib/auth/session";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RediscoveryRepository } from "@/lib/v2/infrastructure/d1/rediscovery-repository";
import "../../v2-product.css";

export const metadata = { title: "예전 기록 다시 보기 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2RediscoveryPage() {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession();
  const repository = new D1RediscoveryRepository(getV2CloudflareBindings().db, session.userId);
  const preference = await repository.getPreference();
  const cards = preference.enabled ? await repository.deck() : [];
  return <main className="v2-product-shell"><nav className="v2-product-nav"><Link href="/v2/explore"><strong>기록 탐색</strong></Link><Link href="/v2/library">보관함</Link></nav><section className="v2-product-card v2-rediscovery-page"><header><p>사용자가 시작하는 회상 세션</p><h1>예전 기록 다시 보기</h1></header><RediscoveryControls enabled={preference.enabled} includeSensitive={preference.includeSensitive} />{preference.enabled ? <RediscoveryDeck cards={cards} /> : null}</section></main>;
}
