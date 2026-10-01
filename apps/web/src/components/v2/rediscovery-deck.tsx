"use client";

import { ChevronLeft, ChevronRight, EyeOff, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SemanticIcon } from "@/components/v2/semantic-icon";
import type { RediscoveryCard } from "@/lib/v2/infrastructure/d1/rediscovery-repository";

async function event(recordId: string, eventKind: "shown" | "opened" | "dismissed") {
  await fetch("/api/v2/rediscovery/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId, eventKind }) });
}

export function RediscoveryDeck({ cards }: { cards: readonly RediscoveryCard[] }) {
  const [visible, setVisible] = useState(cards);
  const [index, setIndex] = useState(0);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void Promise.all(cards.map((card) => event(card.recordId, "shown")));
  }, [cards]);
  const current = visible[index] ?? null;
  if (!current) return <section className="v2-review-empty"><h2>지금 다시 볼 기록이 없습니다.</h2><p>최근에 보여드린 기록은 30일 동안 반복하지 않습니다.</p><Link href="/v2/explore">탐색으로 돌아가기</Link></section>;
  function dismiss() {
    void event(current.recordId, "dismissed");
    setVisible((items) => items.filter((item) => item.recordId !== current.recordId));
    setIndex((value) => Math.max(0, Math.min(value, visible.length - 2)));
  }
  return <section aria-label="예전 기록 다시 보기" className="v2-rediscovery-deck"><article><header><span>{current.privacyLevel === "sensitive" ? <LockKeyhole aria-hidden="true" size={20} /> : <SemanticIcon context="type" iconKey={current.iconKey} size={20} />}</span><div><p>{current.typeLabel} · {new Date(current.capturedAt).toLocaleDateString("ko-KR")}</p><h2>{current.title}</h2></div></header>{current.snippet ? <blockquote>{current.snippet}</blockquote> : <p className="v2-rediscovery-private">민감 기록 · 예상치 못한 재노출을 막기 위해 미리보기를 숨겼습니다.</p>}<footer><button onClick={dismiss} type="button"><EyeOff aria-hidden="true" size={14} /> 이번 기록 그만 보기</button><Link href={`/v2/records/${current.recordId}`} onClick={() => void event(current.recordId, "opened")}>기록 열기</Link></footer></article><nav aria-label="다시 보기 카드 이동"><button aria-label="이전 기록" disabled={index === 0} onClick={() => setIndex((value) => value - 1)} type="button"><ChevronLeft aria-hidden="true" size={18} /></button><span>{index + 1} / {visible.length}</span><button aria-label="다음 기록" disabled={index >= visible.length - 1} onClick={() => setIndex((value) => value + 1)} type="button"><ChevronRight aria-hidden="true" size={18} /></button></nav></section>;
}
