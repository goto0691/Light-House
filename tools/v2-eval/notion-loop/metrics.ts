import { notionDateOnly } from "./notion-export";

/** One stored AI field value, as plain candidates for comparison. */
export type AiFieldValue = Readonly<{ key: string; kind: string; text: string | null; number: number | null; boolean: number | null; date: string | null; json: string }>;

const SEPARATORS = /\s*[,/·|]\s*/;
export const normalizeText = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s.,·/\\|()[\]{}"'`~!?:;_\-–—]+/g, "");
const asSet = (value: string) => new Set(value.normalize("NFKC").toLowerCase().split(SEPARATORS).map((part) => part.replace(/\s+/g, "")).filter(Boolean));

function aiStrings(field: AiFieldValue): string[] {
  const values: string[] = [];
  if (field.text !== null) values.push(field.text);
  if (field.number !== null) values.push(String(field.number));
  if (field.date !== null) values.push(field.date);
  try {
    const parsed = JSON.parse(field.json) as unknown;
    if (Array.isArray(parsed)) values.push(parsed.map(String).join(", "));
    else if (typeof parsed === "string" || typeof parsed === "number") values.push(String(parsed));
  } catch { /* stored JSON is optional for comparison */ }
  return values;
}

/** Whether an AI field carries the owner's Notion value (dates by day, Yes/No as boolean, lists as sets). */
export function notionValueMatches(notionValue: string, field: AiFieldValue): boolean {
  const day = notionDateOnly(notionValue);
  if (day) return aiStrings(field).some((value) => value.startsWith(day));
  if (/^(yes|no)$/i.test(notionValue.trim())) return field.boolean !== null && Boolean(field.boolean) === /^yes$/i.test(notionValue.trim());
  if (/^\d+(\.\d+)?$/.test(notionValue.trim())) return field.number === Number(notionValue) || aiStrings(field).some((value) => normalizeText(value) === notionValue.trim());
  const wanted = normalizeText(notionValue);
  if (!wanted) return false;
  const wantedSet = asSet(notionValue);
  return aiStrings(field).some((value) => {
    const candidate = normalizeText(value);
    if (candidate === wanted) return true;
    const candidateSet = asSet(value);
    if (wantedSet.size > 1 && [...wantedSet].every((part) => candidateSet.has(part))) return true;
    return wanted.length >= 4 && candidate.includes(wanted);
  });
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
}

export const ratio = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);

/** Notion properties scored for field accuracy: short, non-relation values; titles and long prose are not fields. */
export function scoredProperty(name: string, value: string, linked: boolean) {
  return !linked && Boolean(value.trim()) && value.length <= 80 && !["이름", "제목"].includes(name);
}
