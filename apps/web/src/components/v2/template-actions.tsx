"use client";

import { Archive, EyeOff, Pin, PinOff, Play, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "try" | "keep" | "dismiss" | "archive" | "pin" | "unpin";

export function TemplateActions({ templateId, templateVersionId, status, pinned, origin, compact = false }: { templateId: string; templateVersionId: string; status: string; pinned: boolean; origin: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: Action, openCapture = false) {
    setBusy(action); setError(null);
    try {
      const response = await fetch(`/api/v2/templates/${encodeURIComponent(templateId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "템플릿 상태를 바꾸지 못했습니다.");
      if (openCapture) router.push(`/v2/capture?template=${encodeURIComponent(templateVersionId)}`);
      else router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "템플릿 상태를 바꾸지 못했습니다."); setBusy(null); }
  }
  return <div className={`v2-template-actions${compact ? " is-compact" : ""}`}>
    {status === "generated_draft" || status === "suggested" ? <button disabled={Boolean(busy)} onClick={() => void act("try", true)} type="button"><Play aria-hidden="true" size={14} /> 이번에 사용</button> : status === "trial" || status === "active" ? <a href={`/v2/capture?template=${encodeURIComponent(templateVersionId)}`}><Play aria-hidden="true" size={14} /> 사용하기</a> : null}
    {status !== "active" && !["dismissed", "archived", "draft"].includes(status) ? <button className="is-primary" disabled={Boolean(busy)} onClick={() => void act("keep")} type="button"><Save aria-hidden="true" size={14} /> 계속 사용</button> : null}
    {status === "active" ? <button disabled={Boolean(busy)} onClick={() => void act(pinned ? "unpin" : "pin")} type="button">{pinned ? <PinOff aria-hidden="true" size={14} /> : <Pin aria-hidden="true" size={14} />}{pinned ? "고정 해제" : "고정"}</button> : null}
    {["generated_draft", "suggested", "trial"].includes(status) && origin !== "system_seed" ? <button disabled={Boolean(busy)} onClick={() => void act("dismiss")} type="button"><EyeOff aria-hidden="true" size={14} /> 관심 없음</button> : null}
    {status === "active" ? <button disabled={Boolean(busy)} onClick={() => void act("archive")} type="button"><Archive aria-hidden="true" size={14} /> 보관</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
