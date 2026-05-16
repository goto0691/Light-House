type PersonSummaryInput = {
  bio?: string | null;
  coreValue?: string | null;
};

const SOURCE_REFERENCE_PATTERN = /\s*\(page ref:[^)]+\)/gi;
const SOURCE_HEAVY_HINTS = ["page ref:", "지식 창고:", "영상 로그:", "마지막 연락일:", "생일까지:"];
const EMPTY_PERSON_TEXT = new Set(["", "기록 중", "설명이 아직 없습니다."]);

export function cleanSourceArtifacts(value: string | null | undefined) {
  return (value ?? "")
    .replace(SOURCE_REFERENCE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPersonSummaryText(person: PersonSummaryInput, options: { maxLength?: number } = {}) {
  const maxLength = options.maxLength ?? 180;
  const rawBio = person.bio ?? "";
  const cleanedBio = cleanSourceArtifacts(rawBio);
  const cleanedCore = cleanSourceArtifacts(person.coreValue);
  const bioIsSourceHeavy = isSourceHeavyPersonText(rawBio) || isSourceHeavyPersonText(cleanedBio);
  const coreIsUsable = !EMPTY_PERSON_TEXT.has(cleanedCore) && !isSourceHeavyPersonText(cleanedCore);
  const preferred = coreIsUsable ? cleanedCore : bioIsSourceHeavy ? "" : cleanedBio;
  const summary = EMPTY_PERSON_TEXT.has(preferred) ? "원본 속성 정리가 필요한 관계입니다." : preferred;

  return truncate(summary, maxLength);
}

function isSourceHeavyPersonText(value: string) {
  if (value.length > 320) return true;
  if (looksLikePipeDelimitedSourceRow(value)) return true;
  return SOURCE_HEAVY_HINTS.filter((hint) => value.includes(hint)).length >= 1;
}

function looksLikePipeDelimitedSourceRow(value: string) {
  const segments = value.split("|").map((segment) => segment.trim());
  if (segments.length < 6) return false;
  const emptySegments = segments.filter((segment) => !segment).length;
  const terseSourceTokens = segments.filter((segment) => ["d", "yes", "no"].includes(segment.toLowerCase())).length;
  const dateLikeSegments = segments.filter((segment) => /\d{4}년|\d{4}-\d{2}-\d{2}/.test(segment)).length;
  return emptySegments >= 2 || terseSourceTokens >= 1 || dateLikeSegments >= 1;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}
