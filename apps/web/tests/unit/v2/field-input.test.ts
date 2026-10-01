import { describe, expect, test } from "vitest";
import { fieldInputValue, parseFieldCorrection, ratingDisplayValue } from "@/lib/v2/presentation/field-input";

describe("canonical field correction inputs", () => {
  test.each([true, false])("round-trips an unchanged boolean %s without localized labels", (value) => {
    expect(parseFieldCorrection("boolean", fieldInputValue({ renderer: "boolean", value }))).toBe(value);
  });
  test("initializes dates with an HTML date input value and retains the calendar date", () => {
    const value = fieldInputValue({ renderer: "date", value: "2026-09-08T09:00:00.000Z" });
    expect(value).toBe("2026-09-08");
    expect(parseFieldCorrection("date", value)).toBe("2026-09-08");
    expect(() => parseFieldCorrection("date", "2026-02-30")).toThrow();
  });
  test("does not silently coerce blank numbers or invalid boolean labels", () => {
    expect(() => parseFieldCorrection("number", "")).toThrow();
    expect(() => parseFieldCorrection("boolean", "예")).toThrow();
  });
  test("requires explicit correction of a legacy rating outside the five-point scale", () => {
    expect(ratingDisplayValue(90)).toBe("90 (척도 확인 필요)");
    expect(ratingDisplayValue(0)).toBe("0 / 5");
    expect(() => parseFieldCorrection("rating", "90")).toThrow();
    expect(parseFieldCorrection("rating", "4.5")).toBe(4.5);
  });
});
