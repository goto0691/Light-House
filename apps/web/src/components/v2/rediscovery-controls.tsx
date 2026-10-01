"use client";

import { ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RediscoveryControls({ enabled, includeSensitive }: { enabled: boolean; includeSensitive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(next: { enabled: boolean; includeSensitive: boolean }) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v2/rediscovery/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "다시 보기 설정을 바꾸지 못했습니다.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "다시 보기 설정을 바꾸지 못했습니다."); setBusy(false); }
  }
  if (!enabled) return <section className="v2-rediscovery-consent"><ShieldCheck aria-hidden="true" size={28} /><h2>원할 때만 과거 기록을 다시 보여드립니다.</h2><p>켜기 전에는 어떤 기록도 선별하거나 노출하지 않습니다. 잠금 기록은 항상 제외되고, 민감 기록은 별도의 선택 전에는 포함되지 않습니다.</p><button disabled={busy} onClick={() => void update({ enabled: true, includeSensitive: false })} type="button"><ToggleRight aria-hidden="true" size={18} /> 일반 기록 다시 보기 켜기</button>{error ? <small role="alert">{error}</small> : null}</section>;
  return <div className="v2-rediscovery-settings"><label><input checked={includeSensitive} disabled={busy} onChange={(event) => void update({ enabled: true, includeSensitive: event.target.checked })} type="checkbox" /><span><strong>민감 기록도 후보에 포함</strong><small>본문 미리보기는 계속 숨깁니다.</small></span></label><button disabled={busy} onClick={() => void update({ enabled: false, includeSensitive: false })} type="button"><ToggleLeft aria-hidden="true" size={16} /> 다시 보기 끄기</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
