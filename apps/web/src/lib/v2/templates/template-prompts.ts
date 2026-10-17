/**
 * Neutral template questions built from the owner's own field names (D-029):
 * "장르를 남길까요?" asks whether to record, never presumes a value.
 * The object particle follows the last Hangul syllable; other endings get "을(를)".
 */
export function objectParticle(label: string) {
  const last = label.trim().at(-1);
  if (!last) return "을(를)";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "을(를)";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

export function neutralFieldPrompt(label: string) {
  const name = label.trim();
  return `${name}${objectParticle(name)} 남길까요?`;
}

/** Field labels the owner wrote (imported, user-made or system) may appear in a template; AI-generated labels may not. */
export const OWNER_LABEL_ORIGINS = new Set(["imported", "user_created", "system_seed"]);
