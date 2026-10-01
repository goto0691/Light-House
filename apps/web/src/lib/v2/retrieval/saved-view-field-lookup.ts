/** Exact registry metadata lookup is separate from the paginated field search. */
export type SavedViewFieldLabel = Readonly<{ key: string; label: string }>;
const validKey = /^[a-z][a-z0-9_.-]{0,99}$/;

export function validateSavedViewFieldLookupKeys(input: readonly string[]): readonly string[] {
  if (input.length < 1 || input.length > 8 || input.some((key) => typeof key !== "string" || !validKey.test(key))
    || new Set(input).size !== input.length) throw new Error("The selected field lookup is invalid.");
  return Object.freeze([...input]);
}

/** A missing/retired definition stays absent; never substitute a different search result. */
export function parseSavedViewFieldLookup(body: unknown, keys: readonly string[]): readonly SavedViewFieldLabel[] {
  const expected = validateSavedViewFieldLookupKeys(keys);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("fields" in body)
    || !Array.isArray(body.fields) || body.fields.length > expected.length) throw new Error("The selected field lookup response is invalid.");
  let previous = -1;
  return body.fields.map((field: unknown) => {
    if (!field || typeof field !== "object" || Array.isArray(field) || Object.keys(field).length !== 2
      || !("key" in field) || !("label" in field) || typeof field.key !== "string" || typeof field.label !== "string") {
      throw new Error("The selected field lookup response is invalid.");
    }
    const position = expected.indexOf(field.key);
    if (position <= previous) throw new Error("The selected field lookup response is invalid.");
    previous = position;
    return { key: field.key, label: field.label };
  });
}
