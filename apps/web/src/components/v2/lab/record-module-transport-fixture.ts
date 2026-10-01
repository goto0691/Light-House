import { projectFirstContextModule, resolveRecordPreset } from "@/lib/v2/presentation/extension-registry";
import type { PresentedField, RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";

function jsonField(propertyId: string, fieldKey: string, label: string, value: unknown): PresentedField {
  return { propertyId, fieldKey, label, value, dataType: "json", renderer: "json", sourceClass: "user_explicit", sourceLabel: "원문에서 명시함", claimRisk: "low", reviewStatus: "accepted", lockedByUser: false, evidence: [] };
}

/** Synthetic server-owned data. JSON.parse creates literal own keys, never prototype assignments. */
export function createRecordModuleTransportFixture(): RecordKnowledgePresentation {
  const generic = jsonField("transport-generic", "transport_json", "JSON 보존 기본 정보", JSON.parse('{"__proto__":{"sentinel":"generic-proto"},"constructor":{"prototype":{"sentinel":"generic-constructor"}},"sentinel":"generic-value","nested":[{"__proto__":"generic-nested"}]}'));
  const distance: PresentedField = {
    ...jsonField("transport-distance", "distance", "JSON 보존 활동 값", JSON.parse('{"__proto__":{"sentinel":"module-proto"},"constructor":{"prototype":{"sentinel":"module-constructor"}},"sentinel":"module-value","nested":[{"__proto__":"module-nested"}]}')),
    evidence: [{ evidenceId: "transport-evidence", sourceItemId: null, locatorKind: "external_url", quote: "서버에서 보낸 근거 문장도 유지된다.",
      locator: JSON.parse('{"url":"https://example.com/record-module-evidence?fixture=transport","__proto__":{"sentinel":"locator-proto"},"constructor":{"sentinel":"locator-constructor"},"sentinel":"locator-value"}') as Readonly<Record<string, unknown>> }],
  };
  const duration: PresentedField = { ...jsonField("transport-duration", "duration", "활동 시간 (분)", 31), dataType: "number", renderer: "number", sourceClass: "calculated", sourceLabel: "계산됨" };
  const projected = projectFirstContextModule({ preset: resolveRecordPreset("workout.running"), fields: [distance, duration], privacyLevel: "normal" });
  if (!projected) throw new Error("Invalid synthetic module transport fixture.");
  return {
    contractVersion: "record-presentation-v1",
    displayType: { typeKey: "workout.running", label: "달리기", iconKey: "type.running", status: "active", tentative: false, recordPresetKey: "record.workout.v1" },
    highlights: [],
    sections: [{ key: "user_facts", title: "내 기록", fields: [
      { ...jsonField("transport-memo", "memo", "기본 메모", "내가 쓴 감상은 이곳에 남는다."), dataType: "text", renderer: "text" }, generic,
      { ...jsonField("transport-null-boolean", "null_boolean", "아직 정하지 않은 여부", null), dataType: "boolean", renderer: "boolean" },
    ] }],
    connections: [], reviewItems: [], modules: [projected],
  };
}
