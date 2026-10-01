"use client";

import { useState } from "react";
import { RecordKnowledge } from "@/components/v2/record-knowledge";
import { RecordContextModules } from "@/components/v2/record-context-modules";
import { projectFirstContextModule, resolveRecordPreset, type PresentedContextModule } from "@/lib/v2/presentation/extension-registry";
import type { PresentedField, RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";

const modes = [
  ["normal", "정상 운동 보기"], ["unknown", "알 수 없는 보기"], ["version", "보기 버전 불일치"],
  ["missing", "수치가 없는 보기"], ["malformed", "손상된 수치"], ["labels", "손상된 출처"],
  ["list", "손상된 보기 목록"], ["sensitive", "민감한 미리보기"], ["redacted-payload", "민감한 오염 payload"],
  ["locked", "잠긴 보기"], ["long", "긴 값과 출처"], ["duplicate", "중복 보기"], ["boundary", "보기 목록 예산 경계"],
  ["oversized", "보기 목록 예산 초과"], ["render", "보기 렌더 오류"], ["server-json", "실제 서버 JSON 전송"],
] as const;
type Mode = typeof modes[number][0];

function field(key: string, label: string, value: unknown, sourceClass = "user_explicit", sourceLabel = "원문에서 명시함"): PresentedField {
  return { propertyId: `module-audit-${key}`, fieldKey: key, label, dataType: "number", value, renderer: "number", sourceClass, sourceLabel, claimRisk: "low", reviewStatus: "accepted", lockedByUser: sourceClass === "user_locked", evidence: [] };
}

const workoutFields: readonly PresentedField[] = [
  { ...field("distance", "이동 거리", 5.4), evidence: [{ evidenceId: "module-evidence", sourceItemId: "module-audit", locatorKind: "text", locator: { line: 1 }, quote: "5.4km를 달렸다." }] },
  field("duration", "활동 시간 (분)", 31, "user_locked", "사용자가 고정함"),
  field("average_heart_rate", "평균 심박수", 148, "image_ocr", "이미지에서 읽음"),
];
const normal = projectFirstContextModule({ preset: resolveRecordPreset("workout.running"), fields: workoutFields, privacyLevel: "normal" })!;
const genericField: PresentedField = { ...field("memo", "기본 메모", "내가 쓴 감상은 이곳에 남는다."), dataType: "text", renderer: "text" };

function fixtureModules(mode: Mode): unknown {
  if (mode === "unknown") return [{ ...normal, moduleKey: "unregistered.fixture.v999", title: "UNKNOWN MODULE DO NOT RENDER" }];
  if (mode === "version") return [{ ...normal, presentationVersion: 999, title: "VERSION RAW DO NOT RENDER" }];
  if (mode === "missing") return [{ ...normal, fields: [], sourceLabels: [] }];
  if (mode === "malformed") return [{ ...normal, fields: [{ ...workoutFields[0], value: { bad: "MALFORMED VALUE DO NOT RENDER" } }, workoutFields[1]] }];
  if (mode === "labels") return [{ ...normal, sourceLabels: { bad: "MALFORMED SOURCE DO NOT RENDER" } }];
  if (mode === "list") return { bad: "MALFORMED LIST DO NOT RENDER" };
  if (mode === "sensitive") return [projectFirstContextModule({ preset: resolveRecordPreset("workout.running"), fields: workoutFields, privacyLevel: "sensitive" })!];
  if (mode === "redacted-payload" || mode === "locked") return [{ ...normal, previewPolicy: mode === "locked" ? "locked" : "redacted", title: "PRIVATE MODULE TITLE DO NOT RENDER", sourceLabels: ["PRIVATE SOURCE DO NOT RENDER"], fields: workoutFields.map((value) => ({ ...value, value: "PRIVATE VALUE DO NOT RENDER", renderer: "text" })) }];
  if (mode === "long") {
    const label = "긴사용자필드이름".repeat(36), value = `긴값시작${"수치에남긴긴설명".repeat(60)}긴값끝`, sourceLabel = "긴출처설명".repeat(50);
    return [{ ...normal, title: "활동 수치와 원문에 남긴 설명".repeat(12), sourceLabels: [sourceLabel, workoutFields[1].sourceLabel], fields: [{ ...workoutFields[0], label, value, renderer: "text", dataType: "text", sourceLabel }, workoutFields[1]] }];
  }
  if (mode === "duplicate") return [normal, { ...normal }];
  if (mode === "boundary" || mode === "oversized") return Array.from({ length: mode === "boundary" ? 32 : 33 }, () => normal);
  return [normal];
}

function FaultingField({ field: value }: { field: PresentedField }) {
  if (value.fieldKey === "distance") throw new Error("Synthetic context renderer failure");
  return <p>{value.label}</p>;
}

/** Real components, synthetic projected values. This does not exercise the authenticated RSC payload boundary. */
export function RecordModulesAuditFixture({ serverPresentationJson }: { serverPresentationJson?: string }) {
  const [mode, setMode] = useState<Mode>("normal"), [draft, setDraft] = useState("");
  const presentation: RecordKnowledgePresentation = {
    contractVersion: "record-presentation-v1",
    displayType: { typeKey: "workout.running", label: "달리기", iconKey: "type.running", status: "active", tentative: false, recordPresetKey: "record.workout.v1" },
    highlights: [], sections: [{ key: "user_facts", title: "내 기록", fields: [genericField] }], connections: [], reviewItems: [],
    modules: (mode === "render" ? [] : fixtureModules(mode)) as readonly PresentedContextModule[],
  };
  return <main className="v2-product-shell"><div className="v2-product-card v2-record-modules-audit">
    <h1>기록 맞춤 보기 검증</h1><p>실제 RecordKnowledge와 모듈 UI에 합성 자료를 전달합니다. 개인 자료·공급자·서버 권한 검증은 아닙니다.</p>
    <label>보기 시험 조건<select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>{modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <article aria-label="원문" id="source-module-audit"><h2>내가 쓴 원문</h2><p>오늘 아침 5.4km를 달렸다. 이 원문은 맞춤 보기가 실패해도 유지된다.</p></article>
    <label>보존할 입력 초안<textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} /></label>
    <div data-testid="module-knowledge">{mode === "server-json"
      ? serverPresentationJson ? <RecordKnowledge presentationJson={serverPresentationJson} /> : <p role="alert">서버 전송 시험 자료가 없습니다.</p>
      : <RecordKnowledge presentation={presentation} />}
      {mode === "render" ? <RecordContextModules modules={[normal]} Field={FaultingField} /> : null}
    </div>
    {mode === "server-json" && serverPresentationJson ? <details data-testid="transport-locator-inspection"><summary>전송 받은 근거 메타데이터 보기</summary>
      <p>아래는 lab 전송 검사입니다. 실제 모듈 화면은 근거 문장과 외부 링크만 표시합니다.</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify((JSON.parse(serverPresentationJson) as RecordKnowledgePresentation).modules[0].fields[0].evidence[0].locator)}</pre>
    </details> : null}
  </div></main>;
}
