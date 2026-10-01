export class V2HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "V2HttpError";
  }
}

export function assertV2MutationRequest(
  request: Request,
  options: { allowedOrigin?: string; contentTypes?: readonly string[] } = {},
) {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  // The request URL is the canonical default boundary. A public build-time
  // variable must never add a development origin to a production allowlist.
  const configuredOrigin = options.allowedOrigin?.trim() || requestOrigin;
  if (!origin || (origin !== configuredOrigin && origin !== requestOrigin)) {
    throw new V2HttpError(403, "origin_rejected", "The request Origin is not allowed.");
  }
  const allowed = options.contentTypes ?? ["application/json"];
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !allowed.includes(contentType)) {
    throw new V2HttpError(415, "content_type_rejected", "The request Content-Type is not supported.");
  }
}
