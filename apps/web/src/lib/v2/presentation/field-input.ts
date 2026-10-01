import type { PresentedField } from "@/lib/v2/presentation/record-presentation";

/** Form values are canonical data, never the localized display label. */
export function fieldInputValue(field: Pick<PresentedField, "renderer" | "value">): string {
  if (field.value === null || field.value === undefined) return "";
  if (field.renderer === "boolean") return field.value === true ? "true" : "false";
  if (field.renderer === "date") {
    const value = String(field.value);
    return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ? value.slice(0, 10) : "";
  }
  if (typeof field.value === "object") return JSON.stringify(field.value);
  return String(field.value);
}

export function parseFieldCorrection(renderer: PresentedField["renderer"], input: string): unknown {
  if (!input.trim()) throw new Error("정정할 값을 입력해주세요.");
  if (renderer === "boolean") {
    if (input !== "true" && input !== "false") throw new Error("예 또는 아니요를 선택해주세요.");
    return input === "true";
  }
  if (renderer === "number" || renderer === "rating") {
    const value = Number(input);
    if (!Number.isFinite(value)) throw new Error("올바른 숫자를 입력해주세요.");
    if (renderer === "rating" && (value < 0 || value > 5)) throw new Error("평점은 0점부터 5점 사이로 입력해주세요.");
    return value;
  }
  if (renderer === "date") {
    const date = new Date(`${input}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== input) throw new Error("올바른 날짜를 입력해주세요.");
  }
  if (renderer === "json") {
    try { return JSON.parse(input) as unknown; } catch { throw new Error("올바른 JSON 값을 입력해주세요."); }
  }
  return input;
}

export function ratingDisplayValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5
    ? `${value} / 5`
    : `${String(value)} (척도 확인 필요)`;
}
