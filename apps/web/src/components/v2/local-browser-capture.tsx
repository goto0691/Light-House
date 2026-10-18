"use client";

import { Globe, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const MESSAGES: Readonly<Record<string, string>> = {
  local_browser_url_unsupported: "글 하나의 주소만 열 수 있습니다. 예: threads.net/@이름/post/…, instagram.com/p/…",
  local_browser_login_required: "도우미 Chrome 창에서 직접 로그인한 뒤 다시 눌러 주세요.",
  local_browser_blocked: "사이트가 보안 확인을 띄워 멈췄습니다. 답하지 않았습니다. 잠시 뒤 직접 열어 확인해 주세요.",
  local_browser_post_unavailable: "글을 열 수 없습니다. 지워졌거나 비공개일 수 있습니다.",
  local_browser_busy: "다른 글을 여는 중입니다. 끝난 뒤 다시 눌러 주세요.",
  local_browser_unreachable: "도우미가 꺼져 있습니다. npm run dev:local로 다시 시작해 주세요.",
};

/**
 * Opens one Threads/Instagram post the owner picked in this PC's helper Chrome window and keeps its
 * screenshots as a new record, which the owner's ChatGPT plan then reads (local only, read-only).
 */
export function LocalBrowserCapture() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const result = await response?.json().catch(() => null) as { recordId?: string; error?: { code?: string } } | null;
    return { ok: Boolean(response?.ok), result };
  }

  return (
    <section aria-labelledby="local-browser-heading" className="v2-local-browser">
      <h2 id="local-browser-heading"><Globe aria-hidden="true" size={16} /> Threads·Instagram 글 가져오기</h2>
      <p>이 PC의 별도 Chrome 창이 고른 글 하나만 열어 화면을 저장하고, 내 ChatGPT 플랜이 그 화면을 읽습니다. 글자 입력·좋아요·팔로우는 하지 않습니다. 자동 접근이라 계정이 제한될 수 있습니다.</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setState("busy"); setError(null); setCode(null);
        const { ok, result } = await post("/api/v2/local-browser/capture", { url });
        if (ok && result?.recordId) { router.push(`/v2/records/${encodeURIComponent(result.recordId)}`); return; }
        const errorCode = result?.error?.code ?? "local_browser_failed";
        setCode(errorCode);
        setError(MESSAGES[errorCode] ?? "글을 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        setState("idle");
      }}>
        <label>글 주소<input inputMode="url" maxLength={500} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.threads.net/@이름/post/…" required type="url" value={url} /></label>
        <button disabled={state === "busy" || !url.trim()} type="submit">{state === "busy" ? "Chrome 창에서 여는 중… (최대 1분)" : "이 PC 브라우저로 가져오기"}</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {code === "local_browser_login_required" ? <div className="v2-local-browser__login">
        {(["threads", "instagram"] as const).map((site) => <button key={site} type="button" onClick={async () => {
          const { ok } = await post("/api/v2/local-browser/login", { site });
          setError(ok ? "도우미 Chrome 창에 로그인 화면을 열었습니다. 직접 로그인한 뒤 다시 가져오기를 눌러 주세요." : MESSAGES.local_browser_unreachable!);
        }}><LogIn aria-hidden="true" size={14} /> {site === "threads" ? "Threads" : "Instagram"} 로그인 창 열기</button>)}
      </div> : null}
    </section>
  );
}
