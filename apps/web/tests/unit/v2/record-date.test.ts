import { describe, expect, test } from "vitest";

import { formatRecordDate } from "@/lib/v2/presentation/record-date";

describe("the date a record shows", () => {
  test("an imported day without a time reads as that day in Korea, not as 21:00", () => {
    expect(formatRecordDate("2024-08-25T12:00:00.000Z", true)).toBe(new Date("2024-08-25T12:00:00.000Z").toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }));
    expect(formatRecordDate("2024-08-25T12:00:00.000Z", true)).toContain("25");
    expect(formatRecordDate("2024-08-25T12:00:00.000Z", true)).not.toMatch(/오후|9:00/);
  });

  test("a saved time keeps its time of day in Korean time", () => {
    expect(formatRecordDate("2026-10-17T05:30:00.000Z")).toBe(new Date("2026-10-17T05:30:00.000Z").toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }));
    expect(formatRecordDate("2026-10-17T05:30:00.000Z")).toMatch(/2:30/);
  });

  test("no date or an unreadable one shows nothing", () => {
    expect(formatRecordDate(null)).toBeNull();
    expect(formatRecordDate("not a date")).toBeNull();
  });
});
