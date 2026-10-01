import { describe, expect, expectTypeOf, test } from "vitest";

import {
  PROCESSING_FILTER_LABELS,
  PROCESSING_FILTERS,
  PROCESSING_LABELS,
  PROCESSING_PAGE_SIZE,
  PROCESSING_STAGE_LABELS,
  PROCESSING_STATUS_CONTRACT,
  ProcessingStatusQueryError,
  encodeProcessingCursor,
  parseProcessingCursor,
  parseProcessingFilter,
} from "@/lib/v2/domain/processing-status";
import type {
  ProcessingFilter,
  ProcessingRuntime,
  ProcessingStage,
  ProcessingStatus,
  ProcessingStatusItem,
  ProcessingStatusPage,
} from "@/lib/v2/domain/processing-status";

const SAVED_AT = "2026-09-22T13:45:17.123Z";
const RECORD_ID = "record-current-1";

function cursor(date: unknown = SAVED_AT, id: unknown = RECORD_ID, filter: unknown = "all") {
  return JSON.stringify([date, id, filter]);
}

function expectQueryError(action: () => unknown) {
  expect(action).toThrow(ProcessingStatusQueryError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code: "processing_status_query_invalid" });
    expect((error as Error).message).toBe(new ProcessingStatusQueryError().message);
  }
}

describe("processing overview filter boundary", () => {
  test.each([undefined, null, ""])("missing filter %s defaults to all", (value) => {
    expect(parseProcessingFilter(value)).toBe("all");
  });

  test.each(PROCESSING_FILTERS)("accepts the exact known filter %s", (value) => {
    expect(parseProcessingFilter(value)).toBe(value);
  });

  test.each([
    "unknown", "ALL", " all", "all ", "waiting\n", "queued", "needs_review", "restricted",
    "all' OR 1=1 --", "__proto__", 0, false, [], ["all"], { filter: "all" }, new String("all"),
  ])("rejects unknown or non-string filter %#", (value) => {
    expectQueryError(() => parseProcessingFilter(value));
  });
});

describe("processing overview cursor shape and pagination boundary", () => {
  test.each([undefined, null, ""])("missing cursor %s selects the first page", (value) => {
    expect(parseProcessingCursor(value, "all")).toBeNull();
  });

  test.each(PROCESSING_FILTERS)("roundtrips an opaque record identity for %s", (filter) => {
    const encoded = encodeProcessingCursor(SAVED_AT, RECORD_ID, filter);
    expect(JSON.parse(encoded)).toEqual([SAVED_AT, RECORD_ID, filter]);
    expect(parseProcessingCursor(encoded, filter)).toEqual([SAVED_AT, RECORD_ID]);
  });

  test("a cursor is bound to the filter which generated it", () => {
    for (const originalFilter of PROCESSING_FILTERS) {
      for (const requestedFilter of PROCESSING_FILTERS) {
        if (originalFilter === requestedFilter) continue;
        expectQueryError(() => parseProcessingCursor(cursor(SAVED_AT, RECORD_ID, originalFilter), requestedFilter));
      }
    }
  });

  test.each([
    0, false, [], {}, new String(cursor()), " ", "not-json", "null", "false", "123", '"cursor"',
    "[]", JSON.stringify([SAVED_AT, RECORD_ID]), JSON.stringify([SAVED_AT, RECORD_ID, "all", "extra"]),
    JSON.stringify({ savedAt: SAVED_AT, recordId: RECORD_ID, filter: "all" }),
    JSON.stringify({ 0: SAVED_AT, 1: RECORD_ID, 2: "all", length: 3 }),
    cursor(null), cursor(42), cursor(SAVED_AT, null), cursor(SAVED_AT, 42), cursor(SAVED_AT, {}),
    cursor(SAVED_AT, []), cursor(SAVED_AT, RECORD_ID, null), cursor(SAVED_AT, RECORD_ID, ["all"]),
    cursor(SAVED_AT, RECORD_ID, "unknown"), cursor(SAVED_AT, RECORD_ID, "ALL"),
  ])("rejects a malformed or mismatched cursor %#", (value) => {
    expectQueryError(() => parseProcessingCursor(value, "all"));
  });

  test("accepts at most 1024 characters, including JSON whitespace", () => {
    const encoded = cursor();
    const atLimit = encoded + " ".repeat(1024 - encoded.length);
    expect(atLimit).toHaveLength(1024);
    expect(parseProcessingCursor(atLimit, "all")).toEqual([SAVED_AT, RECORD_ID]);
    expectQueryError(() => parseProcessingCursor(`${atLimit} `, "all"));
  });

  test("accepts a 200-character identity without trimming or truncation", () => {
    const id = "가".repeat(200);
    expect(parseProcessingCursor(cursor(SAVED_AT, id), "all")).toEqual([SAVED_AT, id]);
    expectQueryError(() => parseProcessingCursor(cursor(SAVED_AT, `${id}가`), "all"));
    expectQueryError(() => parseProcessingCursor(cursor(SAVED_AT, ""), "all"));
  });

  test.each([
    "record-한글-😀", "x' OR 1=1 --", "x'); DROP TABLE v2_processing_jobs; --", "<script>alert(1)</script>",
    '__proto__', 'record\\quoted"value', 'record?filter=completed&cursor=[]',
  ])("keeps an injection-looking identity opaque and exact %#", (id) => {
    // This is a parsing check, not proof that a later SQL query uses bindings.
    const encoded = encodeProcessingCursor(SAVED_AT, id, "all");
    expect(parseProcessingCursor(encoded, "all")).toEqual([SAVED_AT, id]);
    expect(JSON.parse(encoded)).toEqual([SAVED_AT, id, "all"]);
  });

  test("errors do not reflect supplied JSON or record identities", () => {
    const secret = "private-record-title-do-not-return";
    try {
      parseProcessingCursor(cursor("not-a-date", secret), "all");
      expect.unreachable("malformed cursor should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingStatusQueryError);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain("not-a-date");
    }
  });
});

describe("processing overview cursor timestamp canonicality", () => {
  test.each([
    "1970-01-01T00:00:00.000Z", "2024-02-29T23:59:59.999Z", "2000-02-29T00:00:00.000Z",
    "1900-02-28T00:00:00.000Z", "2026-04-30T00:00:00.000Z", "9999-12-31T23:59:59.999Z",
  ])("accepts the exact existing UTC instant %s", (date) => {
    expect(parseProcessingCursor(cursor(date), "all")).toEqual([date, RECORD_ID]);
  });

  test.each([
    "2026-02-29T00:00:00.000Z", "2026-02-30T00:00:00.000Z", "2026-02-31T00:00:00.000Z",
    "1900-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z", "2026-06-31T00:00:00.000Z",
    "2026-11-31T00:00:00.000Z", "2026-09-22T24:00:00.000Z",
  ])("rejects a non-existent UTC time even when Date.parse normalizes it: %s", (date) => {
    expect(Number.isFinite(Date.parse(date))).toBe(true);
    expect(new Date(date).toISOString()).not.toBe(date);
    expectQueryError(() => parseProcessingCursor(cursor(date), "all"));
  });

  test.each([
    "", "not-a-date", "2026-09-22", "2026-09-22T13:45:17Z", "2026-09-22T13:45:17.12Z",
    "2026-09-22T13:45:17.1230Z", "2026-09-22T13:45:17.123+00:00", "2026-09-22T22:45:17.123+09:00",
    "2026-09-22t13:45:17.123z", "2026-09-22 13:45:17.123Z", " 2026-09-22T13:45:17.123Z",
    "2026-09-22T13:45:17.123Z\n", "2026-00-22T13:45:17.123Z", "2026-13-22T13:45:17.123Z",
    "2026-09-00T13:45:17.123Z", "2026-09-32T13:45:17.123Z", "2026-09-22T25:00:00.000Z",
    "2026-09-22T13:60:00.000Z", "2026-09-22T13:45:60.000Z", "+010000-01-01T00:00:00.000Z",
  ])("rejects a non-canonical or invalid timestamp %#", (date) => {
    expectQueryError(() => parseProcessingCursor(cursor(date), "all"));
  });
});

describe("processing overview DTO and status vocabulary", () => {
  test("declares a bounded read-only v1 page with known filter labels", () => {
    expect(PROCESSING_STATUS_CONTRACT).toBe("processing-status.v1");
    expect(PROCESSING_PAGE_SIZE).toBe(20);
    expect(PROCESSING_FILTERS).toEqual(["all", "waiting", "attention", "completed", "unprocessed"]);
    expect(Object.keys(PROCESSING_FILTER_LABELS)).toEqual([...PROCESSING_FILTERS]);
    expectTypeOf<ProcessingStatusPage["contract"]>().toEqualTypeOf<"processing-status.v1">();
    expectTypeOf<ProcessingStatusPage["counts"]>().toEqualTypeOf<Readonly<Record<ProcessingFilter, number>>>();
  });

  test("saved storage is independent from analysis failure, partial output and review", () => {
    expectTypeOf<ProcessingStatusItem["storage"]>().toEqualTypeOf<"saved">();
    expectTypeOf<ProcessingStatusItem["status"]>().toEqualTypeOf<ProcessingStatus>();
    expectTypeOf<ProcessingStatusItem["partial"]>().toEqualTypeOf<boolean>();
    expectTypeOf<ProcessingStatusItem["reviewPending"]>().toEqualTypeOf<boolean>();
    expect(PROCESSING_LABELS).toEqual({
      queued: "분석 대기", processing: "분석 중", retry_wait: "자동 재시도 대기", needs_review: "확인 필요",
      completed: "분석 완료", outdated: "현재 원문 분석 필요", unprocessed: "분석하지 않음", restricted: "잠긴 기록",
    });
    expect(Object.values(PROCESSING_LABELS)).not.toContain("저장 실패");
  });

  test("preserves independent stages and provider roles without worker identities", () => {
    expect(PROCESSING_STAGE_LABELS).toEqual({ analyze: "내 글 정리", grounded_enrich: "외부 사실 검색", link_analyze: "링크 원문 정리" });
    expectTypeOf<keyof typeof PROCESSING_STAGE_LABELS>().toEqualTypeOf<ProcessingStage>();
    expectTypeOf<keyof ProcessingRuntime["roles"][number]>().toEqualTypeOf<"role" | "state" | "retryAt">();
    expectTypeOf<ProcessingRuntime["roles"][number]["role"]>().toEqualTypeOf<"main_analyzer" | "grounded_enricher">();
  });

  test("status labels cannot be changed by a consumer", () => {
    expect(Object.isFrozen(PROCESSING_LABELS)).toBe(true);
    expect(Object.isFrozen(PROCESSING_STAGE_LABELS)).toBe(true);
    expect(Object.isFrozen(PROCESSING_FILTER_LABELS)).toBe(true);
  });
});
