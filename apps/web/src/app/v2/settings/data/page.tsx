import Link from "next/link";
import { notFound } from "next/navigation";

import { DataPortabilityClient } from "@/components/v2/data-portability-client";
import { requireSession } from "@/lib/auth/session";
import { getActiveRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { exportJobForSession } from "@/lib/v2/portability/export-access-v1";
import "../../v2-product.css";

export const metadata = { title: "데이터 이동 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2DataSettingsPage() {
  if (!getV2ServerFeatureFlags().routes) notFound();
  const session = await requireSession();
  const db = getV2CloudflareBindings().db;
  const [jobs, backups, restrictedGrant] = await Promise.all([
    new D1PortabilityRepository(db, session.userId).listExports(),
    db.prepare(`select id,snapshot_kind,status,end_sequence,referenced_blob_count,referenced_blob_bytes,retention_class,pinned,created_at,verified_at,build_phase,state_revision,failure_code from v2_backup_snapshots where user_id=? order by created_at desc limit 50`).bind(session.userId).all<{ id: string; snapshot_kind: "full" | "incremental"; status: string; end_sequence: number; referenced_blob_count: number; referenced_blob_bytes: number; retention_class: "manual" | "daily" | "weekly" | "monthly"; pinned: number; created_at: string; verified_at: string | null; build_phase: string; state_revision: number; failure_code: string | null }>(),
    getActiveRestrictedGrant(db, { userId: session.userId, sessionId: session.sessionId }),
  ]);
  const visibleJobs = jobs.map((job) => exportJobForSession(job, Boolean(restrictedGrant)));
  return <main className="v2-product-shell"><nav className="v2-product-nav"><Link href="/v2/library"><strong>Light House</strong></Link><Link href="/v2/library">보관함</Link></nav><section className="v2-product-card v2-portability-page"><header><p>내 데이터는 앱보다 오래 남아야 합니다</p><h1>내보내기와 복원</h1><span>원본을 보존하고, 바뀔 내용을 먼저 확인한 뒤 명시적으로 실행합니다.</span></header><DataPortabilityClient initialJobs={visibleJobs.map((job) => ({ id: job.id, profile: job.profile, scope: job.scope, status: job.status, createdAt: job.createdAt, bundleSizeBytes: job.bundleSizeBytes, failureCode: job.failureCode }))} initialSnapshots={backups.results} /></section></main>;
}
