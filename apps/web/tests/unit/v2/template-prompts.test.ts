import { describe, expect, test } from "vitest";

import { neutralFieldPrompt, objectParticle } from "@/lib/v2/templates/template-prompts";

describe("neutral template questions in the owner's field names", () => {
  test("the object particle follows the last syllable", () => {
    expect(objectParticle("장르")).toBe("를");
    expect(objectParticle("플랫폼")).toBe("을");
    expect(objectParticle("감독/크리에이터")).toBe("를");
    expect(objectParticle("평점")).toBe("을");
    expect(objectParticle("Rating")).toBe("을(를)");
    expect(objectParticle("")).toBe("을(를)");
  });

  test("questions ask whether to record and never suggest a value", () => {
    expect(neutralFieldPrompt(" 시청상태 ")).toBe("시청상태를 남길까요?");
    expect(neutralFieldPrompt("한줄평")).toBe("한줄평을 남길까요?");
  });
});
