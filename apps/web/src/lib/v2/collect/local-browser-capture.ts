import { ulid } from "ulidx";

import { buildPrivateOriginalKey, type AttachmentReservation } from "@/lib/v2/domain/attachment-reservation";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1AttachmentReservationRepository } from "@/lib/v2/infrastructure/d1/attachment-reservation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { putReservedUpload, verifyReservedUpload, type R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";

/**
 * Owner-picked Threads/Instagram posts opened on the owner's own PC (2026-10-19 decision).
 * A local helper (scripts/local-browser-runner.mjs) opens one post the owner chose in a
 * dedicated Chrome profile the owner logged into, expands it read-only (only "더 보기" and
 * "다음" are ever clicked; nothing is typed, liked or followed) and returns screenshots.
 * The app saves them as an ordinary new record with AI on, so the owner's ChatGPT plan reads
 * them like any attached image. Nothing here runs on the deployed Worker: without the local
 * helper's address the route answers unavailable.
 */
export const LOCAL_BROWSER_LIMITS = Object.freeze({ screenshots: 8, screenshotBytes: 8 * 1024 * 1024, titleChars: 200, timeoutMs: 120_000 });

export type LocalBrowserSite = "threads" | "instagram";
export type LocalBrowserStatus = "captured" | "login_required" | "blocked" | "unavailable";

const THREADS_HOSTS = new Set(["threads.net", "www.threads.net", "threads.com", "www.threads.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const THREADS_POST = /^\/@[A-Za-z0-9._]{1,40}\/post\/[A-Za-z0-9_-]{5,60}\/?$/;
const INSTAGRAM_POST = /^\/(?:[A-Za-z0-9._]{1,40}\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,60}\/?$/;

/** One post address the owner chose; anything else (profiles, feeds, search, other sites) is refused. */
export function parseLocalBrowserPostUrl(raw: unknown): { url: string; site: LocalBrowserSite } | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase();
  const site: LocalBrowserSite | null = THREADS_HOSTS.has(host) && THREADS_POST.test(parsed.pathname) ? "threads"
    : INSTAGRAM_HOSTS.has(host) && INSTAGRAM_POST.test(parsed.pathname) ? "instagram" : null;
  if (!site) return null;
  return { url: `https://${host}${parsed.pathname}`, site };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The helper's answer, checked before anything is stored: a status, and for a capture 1–8 PNG screenshots. */
export function parseLocalBrowserResult(value: unknown): { status: LocalBrowserStatus; title: string | null; screenshots: Uint8Array[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!["captured", "login_required", "blocked", "unavailable"].includes(String(body.status))) return null;
  const status = body.status as LocalBrowserStatus;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, LOCAL_BROWSER_LIMITS.titleChars) : null;
  if (status !== "captured") return { status, title, screenshots: [] };
  if (!Array.isArray(body.screenshots) || !body.screenshots.length || body.screenshots.length > LOCAL_BROWSER_LIMITS.screenshots) return null;
  const screenshots: Uint8Array[] = [];
  for (const item of body.screenshots) {
    if (typeof item !== "string" || item.length > LOCAL_BROWSER_LIMITS.screenshotBytes * 1.4) return null;
    const bytes = Uint8Array.from(atob(item), (char) => char.charCodeAt(0));
    if (bytes.byteLength > LOCAL_BROWSER_LIMITS.screenshotBytes || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
    screenshots.push(bytes);
  }
  return { status, title, screenshots };
}

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Store the screenshots through the usual reserve → upload → verify steps, then commit one new record. */
export async function saveLocalBrowserCapture(db: D1DatabaseBinding, bucket: R2BucketBinding, userId: string,
  input: Readonly<{ url: string; title: string | null; screenshots: readonly Uint8Array[]; now: Date }>) {
  const reservations = new D1AttachmentReservationRepository(db, userId);
  const now = input.now.toISOString();
  const images: { attachmentId: string; sha256: string }[] = [];
  for (const [index, screenshot] of input.screenshots.entries()) {
    const bytes = new Uint8Array(screenshot);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const id = ulid();
    const reservation: AttachmentReservation = {
      id, userId, objectKey: buildPrivateOriginalKey({ userId, reservationId: id, reservedAt: now }),
      filename: `post-${index + 1}.png`, expectedSize: bytes.byteLength, expectedMimeType: "image/png", expectedSha256: hex(digest),
      expiresAt: new Date(input.now.getTime() + 15 * 60 * 1000).toISOString(),
    };
    await reservations.create(reservation, now);
    await putReservedUpload(bucket, reservation, bytes, digest);
    await reservations.markUploadedUnverified(id);
    await verifyReservedUpload(bucket, reservation, { removeOnFailure: true });
    await reservations.markVerified(id, now);
    images.push({ attachmentId: id, sha256: hex(digest) });
  }
  const urlHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.url)));
  const draftId = `local-browser-${crypto.randomUUID()}`;
  const capture = await prepareCaptureCommit({
    draftId, channel: "web", title: input.title, bodyMarkdown: "", aiEnabled: true,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now,
    sources: [
      { kind: "url", rawText: input.url, contentHash: urlHash },
      ...images.map((image) => ({ kind: "image" as const, rawText: null, contentHash: image.sha256, attachmentId: image.attachmentId })),
    ],
  }, draftId, now);
  const receipt = await new D1SourceFoundationRepository(db, userId).commitCapture(capture);
  return { recordId: receipt.recordId, screenshots: images.length };
}
