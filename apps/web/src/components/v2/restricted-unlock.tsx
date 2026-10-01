"use client";

import { KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RestrictedUnlock() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v2/auth/restricted-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "재인증하지 못했습니다.");
      setPassword("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "재인증하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="v2-record-locked">
      <LockKeyhole aria-hidden="true" size={30} />
      <h1>잠긴 기록</h1>
      <p>현재 계정의 비밀번호로 다시 확인하면 이 세션에서 10분 동안 제목·본문·첨부를 열 수 있습니다.</p>
      <form className="v2-restricted-form" onSubmit={unlock}>
        <label><span>비밀번호</span><input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        <button className="v2-product-primary" disabled={pending || !password} type="submit">
          {pending ? <LoaderCircle aria-hidden="true" className="v2-spinner" size={17} /> : <KeyRound aria-hidden="true" size={17} />}
          {pending ? "확인 중" : "10분 동안 열기"}
        </button>
        {error ? <p className="v2-product-error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
