/**
 * The date a record shows (D-119). A record the owner kept elsewhere with no date of its
 * own shows no date, instead of the day it was brought in, until the owner edits it; its
 * capture still keeps the real save time. An imported day without a time of day is stored
 * at 12:00 UTC (the same day everywhere in Korea) and shown as a day, not "오후 9:00".
 */
export const RECORD_TIME_ZONE = "Asia/Seoul";

/** SQL: an untouched imported record without a date of its own. */
export function undatedImportSql(document: string, capture: string) {
  return `(${document}.written_at is null and ${document}.current_version=1 and ${capture}.draft_id like 'notion:%')`;
}

/** SQL: an untouched imported record whose written date is a day without a time. */
export function dayOnlyImportSql(document: string, capture: string) {
  return `(${document}.written_at like '%T12:00:00.000Z' and ${document}.current_version=1 and ${capture}.draft_id like 'notion:%')`;
}

export function formatRecordDate(iso: string | null, dayOnly = false, timeZone = RECORD_TIME_ZONE) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return dayOnly ? date.toLocaleDateString("ko-KR", { timeZone }) : date.toLocaleString("ko-KR", { timeZone });
}
