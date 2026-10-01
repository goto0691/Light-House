/** Read-only processing overview. This contract never grants permission to run a job. */
export const PROCESSING_STATUS_CONTRACT = "processing-status.v1";
export const PROCESSING_PAGE_SIZE = 20;
export const PROCESSING_FILTERS = ["all", "waiting", "attention", "completed", "unprocessed"] as const;
export type ProcessingFilter = typeof PROCESSING_FILTERS[number];
export type ProcessingStatus = "queued" | "processing" | "retry_wait" | "needs_review" | "completed" | "outdated" | "unprocessed" | "restricted";
export type ProcessingStage = "analyze" | "grounded_enrich" | "link_analyze";
export type ProcessingStageSummary = Readonly<{ stage: ProcessingStage; status: ProcessingStatus; count: number; nextAttemptAt: string | null }>;
export type ProcessingStatusItem = Readonly<{
  recordId: string;
  title: string;
  privacyLevel: "normal" | "sensitive" | "restricted";
  savedAt: string;
  storage: "saved";
  status: ProcessingStatus;
  /** Partial runs and proposed results are not silently presented as fully checked. */
  partial: boolean;
  reviewPending: boolean;
  stages: readonly ProcessingStageSummary[];
}>;
export type ProcessingRuntime = Readonly<{
  enabled: boolean;
  configured: boolean;
  roles: readonly Readonly<{ role: "main_analyzer" | "grounded_enricher"; state: "unknown" | "healthy" | "throttled" | "quota_exhausted" | "circuit_open"; retryAt: string | null }>[];
}>;
export type ProcessingStatusPage = Readonly<{
  contract: typeof PROCESSING_STATUS_CONTRACT;
  filter: ProcessingFilter;
  items: readonly ProcessingStatusItem[];
  counts: Readonly<Record<ProcessingFilter, number>>;
  nextCursor: string | null;
  checkedAt: string;
  runtime: ProcessingRuntime;
}>;

export class ProcessingStatusQueryError extends Error {
  readonly code = "processing_status_query_invalid";
  constructor() { super("처리 상태 조회 조건이 올바르지 않습니다. 첫 페이지부터 다시 확인해 주세요."); }
}
export function parseProcessingFilter(value: unknown): ProcessingFilter {
  if (value === undefined || value === null || value === "") return "all";
  if (typeof value !== "string" || !PROCESSING_FILTERS.includes(value as ProcessingFilter)) throw new ProcessingStatusQueryError();
  return value as ProcessingFilter;
}
export function encodeProcessingCursor(savedAt: string, recordId: string, filter: ProcessingFilter) {
  return JSON.stringify([savedAt, recordId, filter]);
}
export function parseProcessingCursor(value: unknown, filter: ProcessingFilter): readonly [string, string] | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1024) throw new ProcessingStatusQueryError();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 3 || typeof parsed[0] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed[0]) || !Number.isFinite(Date.parse(parsed[0])) || new Date(parsed[0]).toISOString() !== parsed[0]
      || typeof parsed[1] !== "string" || !parsed[1] || parsed[1].length > 200 || parsed[2] !== filter) throw new Error();
    return [parsed[0], parsed[1]];
  } catch { throw new ProcessingStatusQueryError(); }
}

export const PROCESSING_LABELS: Readonly<Record<ProcessingStatus, string>> = Object.freeze({
  queued: "분석 대기", processing: "분석 중", retry_wait: "자동 재시도 대기", needs_review: "확인 필요",
  completed: "분석 완료", outdated: "현재 원문 분석 필요", unprocessed: "분석하지 않음", restricted: "잠긴 기록",
});
export const PROCESSING_STAGE_LABELS: Readonly<Record<ProcessingStage, string>> = Object.freeze({ analyze: "내 글 정리", grounded_enrich: "외부 사실 검색", link_analyze: "링크 원문 정리" });
export const PROCESSING_FILTER_LABELS: Readonly<Record<ProcessingFilter, string>> = Object.freeze({ all: "전체", waiting: "진행·대기", attention: "확인 필요", completed: "분석 완료", unprocessed: "미분석·잠김" });
