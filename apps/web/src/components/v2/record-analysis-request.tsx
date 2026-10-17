"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shown on a normal record saved with AI off: one explicit request sends its current text for AI organization. */
export function RecordAnalysisRequest({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "queued" | "failed">("idle");
  if (state === "queued") return <p className="v2-analysis-request" role="status">AI 정리를 요청했습니다. 진행은 <Link href="/v2/processing">처리 상태</Link>에서 볼 수 있습니다.</p>;
  return <div className="v2-analysis-request">
    <p>이 기록은 AI 정리 없이 저장되어 있습니다. 요청하면 지금 본문을 AI가 읽고 분류·항목을 제안합니다. 이미 적힌 값은 바꾸지 않고, 다른 제안은 따로 보여 줍니다.</p>
    <button type="button" disabled={state === "busy"} onClick={async () => {
      setState("busy");
      const response = await fetch(`/api/v2/records/${encodeURIComponent(recordId)}/analysis-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
      if (response?.ok) { setState("queued"); router.refresh(); } else setState("failed");
    }}><Sparkles aria-hidden="true" size={14} /> AI 정리 요청</button>
    {state === "failed" ? <p role="alert">요청하지 못했습니다. 새로 고친 뒤 다시 시도하세요.</p> : null}
  </div>;
}
