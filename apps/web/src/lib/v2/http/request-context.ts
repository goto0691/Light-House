import "server-only";

import { getSession } from "@/lib/auth/session";
import { getActiveRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { assertV2MutationRequest, V2HttpError } from "@/lib/v2/http/request-policy";

export { V2HttpError } from "@/lib/v2/http/request-policy";

export type V2RequestContext = Readonly<{
  userId: string;
  email: string;
  sessionId: string;
  sessionIssuedAt: string;
  restrictedGrant?: Readonly<{ expiresAt: string }>;
}>;

export async function requireV2RequestContext(
  request: Request,
  options: {
    mutation?: boolean;
    contentTypes?: readonly string[];
    sessionResolver?: typeof getSession;
    restrictedGrantResolver?: (input: { userId: string; sessionId: string }) => Promise<{ expiresAt: string } | null>;
  } = {},
): Promise<V2RequestContext> {
  if (options.mutation) assertV2MutationRequest(request, { contentTypes: options.contentTypes });
  const session = await (options.sessionResolver ?? getSession)();
  if (!session) throw new V2HttpError(401, "authentication_required", "Authentication is required.");
  const restrictedGrant = await (
    options.restrictedGrantResolver
    ?? ((input) => getActiveRestrictedGrant(getV2CloudflareBindings().db, input))
  )({ userId: session.userId, sessionId: session.sessionId });
  return {
    userId: session.userId,
    email: session.email,
    sessionId: session.sessionId,
    sessionIssuedAt: new Date(session.expiresAt - 7 * 24 * 60 * 60 * 1000).toISOString(),
    restrictedGrant: restrictedGrant ?? undefined,
  };
}

export function v2ErrorResponse(error: unknown) {
  if (error instanceof V2HttpError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "restricted_record_locked") {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 423 });
  }
  if (candidate.code === "document_revision_schema_required") {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 503 });
  }
  if (candidate.code === "idempotency_conflict") {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 409 });
  }
  if (candidate.code?.endsWith("_not_found")) {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 404 });
  }
  if (candidate.code?.endsWith("_invalid")) {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 400 });
  }
  if (candidate.code?.endsWith("_limit")) {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 409 });
  }
  if (candidate.code?.endsWith("_disabled")) {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 409 });
  }
  if (candidate.code?.includes("conflict") || candidate.code?.endsWith("dry_run_changed")) {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 409 });
  }
  if (candidate.code?.includes("invalid") || candidate.code?.includes("mismatch") || candidate.code?.includes("incomplete") || candidate.code?.includes("unmanifested")) {
    return Response.json({ error: { code: candidate.code, message: candidate.message } }, { status: 400 });
  }
  return Response.json({ error: { code: "internal_error", message: "The request could not be completed." } }, { status: 500 });
}
