"use client";

import { useState } from "react";
import { ProcessingStatusView } from "@/components/v2/processing-status-view";
import { encodeProcessingCursor, PROCESSING_STATUS_CONTRACT, type ProcessingStatus, type ProcessingStatusItem, type ProcessingStatusPage } from "@/lib/v2/domain/processing-status";

const states: readonly ProcessingStatus[] = ["queued", "processing", "retry_wait", "needs_review", "completed", "outdated", "unprocessed", "restricted"];
function initial(): ProcessingStatusPage {
  const items: ProcessingStatusItem[] = Array.from({ length: 45 }, (_, index) => {
    const stageStatus = states[index % states.length], status = index === 4 ? "needs_review" : stageStatus, restricted = status === "restricted", sensitive = index === 8;
    return { recordId: `processing-${String(index).padStart(3, "0")}`, title: restricted ? "잠긴 기록" : sensitive ? "민감 기록" : index === 0 ? `긴제목${"줄바꿈없이남긴기록제목".repeat(36)}끝` : `합성 처리 기록 ${String(index + 1).padStart(3, "0")}`, privacyLevel: restricted ? "restricted" : sensitive ? "sensitive" : "normal",
      savedAt: new Date(Date.UTC(2026, 8, 22, 9, 45 - index)).toISOString(), storage: "saved", status, partial: index === 4, reviewPending: index === 4,
      stages: restricted || status === "unprocessed" ? [] : [{ stage: "analyze", status: stageStatus, count: 1, nextAttemptAt: status === "retry_wait" ? "2026-09-22T10:00:00.000Z" : null }] };
  });
  return { contract: PROCESSING_STATUS_CONTRACT, filter: "all", items: items.slice(0, 20), counts: { all: 45, waiting: 18, attention: 12, completed: 5, unprocessed: 10 }, nextCursor: encodeProcessingCursor(items[19].savedAt, items[19].recordId, "all"), checkedAt: "2026-09-22T09:50:00.000Z",
    runtime: { enabled: true, configured: true, roles: [{ role: "main_analyzer", state: "unknown", retryAt: null }, { role: "grounded_enricher", state: "quota_exhausted", retryAt: "2026-09-23T00:00:00.000Z" }] } };
}

/** Actual read-only UI with synthetic safe metadata; API responses are supplied by the browser tests. */
export function ProcessingStatusAuditFixture() {
  const [mode, setMode] = useState<"initial" | "api" | "closed">("initial");
  return <><aside style={{ padding: 16, background: "#fffdf8", color: "#29352f", display: "grid", gap: 10 }} aria-label="합성 처리 상태 시험 도구">
    <p>합성 상태와 실제 컴포넌트 시험입니다. 실제 공급자·실기기·개인 자료 검증이 아닙니다.</p>
    <label>화면 밖 메모<textarea rows={2} style={{ display: "block", width: "100%", color: "#29352f", background: "white", border: "1px solid #748575" }} /></label>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><button type="button" onClick={() => setMode("api")}>API부터 확인</button><button type="button" onClick={() => setMode("closed")}>처리 화면 닫기</button><button type="button" onClick={() => setMode("initial")}>합성 화면 다시 열기</button></div>
  </aside>{mode === "closed" ? <p>처리 화면을 닫았습니다.</p> : <ProcessingStatusView key={mode} initialPage={mode === "initial" ? initial() : null} />}</>;
}
