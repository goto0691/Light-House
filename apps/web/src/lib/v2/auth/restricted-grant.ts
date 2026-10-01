import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

const RESTRICTED_GRANT_COOKIE = "lh_restricted_grant";
const RESTRICTED_GRANT_TTL_MS = 10 * 60 * 1000;

/** Request-time check, repeated after protected projections finish loading. */
export function hasUnexpiredRestrictedGrant(grant: Readonly<{ expiresAt: string }> | null | undefined) {
  return Boolean(grant && Date.parse(grant.expiresAt) > Date.now());
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issueRestrictedGrant(db: D1DatabaseBinding, input: { userId: string; sessionId: string }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESTRICTED_GRANT_TTL_MS);
  const token = `rg_${randomBytes(32).toString("base64url")}`;
  const hash = tokenHash(token);
  await db.prepare(
    `insert into v2_restricted_grants (id,user_id,session_id,token_hash,created_at,expires_at)
     values (?,?,?,?,?,?)`,
  ).bind(`grant_${randomUUID().replaceAll("-", "")}`, input.userId, input.sessionId, hash, now.toISOString(), expiresAt.toISOString()).run();
  const store = await cookies();
  store.set(RESTRICTED_GRANT_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return { expiresAt: expiresAt.toISOString() };
}

export async function getActiveRestrictedGrant(db: D1DatabaseBinding, input: { userId: string; sessionId: string }) {
  const store = await cookies();
  const token = store.get(RESTRICTED_GRANT_COOKIE)?.value;
  if (!token) return null;
  const grant = await db.prepare(
    `select expires_at as expiresAt from v2_restricted_grants
     where user_id=? and session_id=? and token_hash=? and revoked_at is null and expires_at>? limit 1`,
  ).bind(input.userId, input.sessionId, tokenHash(token), new Date().toISOString()).first<{ expiresAt: string }>();
  // This read also runs during Server Component rendering, where cookies are
  // immutable. Invalid tokens simply remain locked; issue/revoke own writes.
  if (!grant) return null;
  return grant;
}

export async function revokeRestrictedGrant(db: D1DatabaseBinding, input: { userId: string; sessionId: string }) {
  const now = new Date().toISOString();
  await db.prepare(
    `update v2_restricted_grants set revoked_at=? where user_id=? and session_id=? and revoked_at is null`,
  ).bind(now, input.userId, input.sessionId).run();
  const store = await cookies();
  store.delete(RESTRICTED_GRANT_COOKIE);
}
