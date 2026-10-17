import { v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { EntityCurationError } from "@/lib/v2/infrastructure/d1/entity-curation-repository";

export function entityCurationErrorResponse(error: unknown) {
  if (error instanceof EntityCurationError) {
    const status = error.code === "entity_not_found" ? 404 : error.code === "entity_changed" ? 409 : 400;
    return v2ErrorResponse(new V2HttpError(status, error.code, error.message));
  }
  return v2ErrorResponse(error);
}
