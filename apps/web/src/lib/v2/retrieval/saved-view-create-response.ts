import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { validateSavedViewDefinition, type V2SavedViewDefinition } from "@/lib/v2/retrieval/saved-view-contract";

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** Validator constructs fresh nested data; freeze that snapshot before the fetch boundary. */
export function captureSavedViewCreateDefinition(candidate: unknown): V2SavedViewDefinition {
  return freezeTree(validateSavedViewDefinition(candidate));
}

const mismatch = "저장 응답이 요청한 목록과 다릅니다. 입력은 유지됩니다.";

/** Content confirmation, not idempotency or proof of a previously known new-record identity. */
export function confirmSavedViewCreateResponse(body: unknown, selected: V2SavedViewDefinition): string {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("view" in body)
      || !body.view || typeof body.view !== "object" || Array.isArray(body.view)) throw new Error(mismatch);
    const view = body.view as Record<string, unknown>;
    // D1SavedViewRepository.create issues an uppercase ULID through ulidx.ulid(). Its value is not known before creation.
    if (typeof view.id !== "string" || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(view.id)) throw new Error(mismatch);
    const actual = validateSavedViewDefinition({ name: view.name, description: view.description, iconKey: view.iconKey, queryPlan: view.queryPlan, display: view.display });
    if (view.name !== selected.name || view.description !== selected.description || view.iconKey !== selected.iconKey
      || JSON.stringify(actual) !== JSON.stringify(selected)) throw new Error(mismatch);
    // A fresh create stores JSON.stringify(validated display), unlike arbitrary historical rows with different whitespace.
    const revision = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(selected.display))));
    if (view.displayRevision !== revision) throw new Error(mismatch);
    return view.id;
  } catch {
    throw new Error(mismatch);
  }
}
