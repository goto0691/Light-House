"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorRecoveryPolicyInput } from "@/lib/v2/editor/editor-working-copy";
import { LinkWorkingCopyStore, type LinkWorkingCopy } from "@/lib/v2/editor/link-working-copy";
import { LinkDraftSession, type LinkDraftSaveToken } from "@/lib/v2/editor/link-draft-session";
import { onLinkDraftAccessRevoked } from "@/lib/v2/editor/link-draft-access";

export type LinkRecoveryIdentity = EditorRecoveryPolicyInput;
type Options<T> = {
  active?: boolean;
  identity: LinkRecoveryIdentity;
  kind: LinkWorkingCopy["kind"];
  parse: (value: unknown) => T;
  onAccessDenied: () => void;
};
type DraftRow<T> = LinkWorkingCopy & { payload: T };

/** Separate tab IDs and generation fences; never feeds the new-Capture outbox. */
export function useLinkDraftRecovery<T>({ identity, kind, parse, onAccessDenied, active = true }: Options<T>) {
  const [store] = useState(() => new LinkWorkingCopyStore());
  const [session] = useState(() => new LinkDraftSession(identity, kind));
  const [policy, setPolicy] = useState(identity);
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(identity.privacyLevel === "normal");
  const [copies, setCopies] = useState<DraftRow<T>[]>([]);
  const [status, setStatus] = useState("기기 복구 준비 중");
  const [hasSuspended, setHasSuspended] = useState(false);
  const suspended = useRef(false);
  const readyRef = useRef(false), enabledRef = useRef(enabled), policyRef = useRef(identity);
  const mounted = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verification = useRef(0);
  const consentEpoch = useRef(0);
  const persistence = useRef(new Set<AbortController>());
  const accessDenied = useRef(onAccessDenied);
  useEffect(() => { accessDenied.current = onAccessDenied; }, [onAccessDenied]);
  const identityKey = JSON.stringify([identity.ownerId, identity.recordId]);
  const [initialIdentityKey] = useState(identityKey);

  const load = useCallback(async (checked: EditorRecoveryPolicyInput, consent: boolean) => {
    const attempt = verification.current, consentVersion = consentEpoch.current;
    if (!consent || !enabledRef.current || !readyRef.current) return [];
    const rows = await store.list(checked.ownerId, checked.recordId, consent && checked.privacyLevel === "sensitive");
    const valid: DraftRow<T>[] = [];
    for (const row of rows) {
      if (row.id === session.snapshot()?.id || row.kind !== kind) continue;
      try { valid.push({ ...row, payload: parse(row.payload) }); } catch { /* Unknown drafts are not restored or silently deleted. */ }
    }
    if (!mounted.current || !readyRef.current || !enabledRef.current || attempt !== verification.current || consentVersion !== consentEpoch.current) return [];
    setCopies(valid);
    return valid;
  }, [store, session, kind, parse]);

  const verify = useCallback(async (): Promise<EditorRecoveryPolicyInput> => {
    const attempt = ++verification.current;
    readyRef.current = false;
    if (mounted.current) { setReady(false); setCopies([]); setStatus("서버 보호 정책 확인 중 · 기기 복구 일시 중지"); }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/v2/records/${encodeURIComponent(identity.recordId)}/recovery-policy`, { cache: "no-store", signal: controller.signal });
      if (!mounted.current || attempt !== verification.current) throw new Error("더 최신 보호 정책을 확인하고 있습니다.");
      if ([401, 403, 404, 423].includes(response.status)) { accessDenied.current(); throw new Error("인증을 확인한 뒤 기기 초안을 다시 열어 주세요."); }
      if (!response.ok) throw new Error("서버 보호 정책을 확인하지 못했습니다. 기기 복구는 중지되어 있습니다.");
      const body = await response.json() as { recoveryPolicy?: EditorRecoveryPolicyInput; contentReadable?: boolean };
      if (!mounted.current || attempt !== verification.current) throw new Error("더 최신 보호 정책을 확인하고 있습니다.");
      const next = body?.recoveryPolicy;
      if (!next || next.ownerId !== identity.ownerId || next.recordId !== identity.recordId) {
        accessDenied.current(); throw new Error("로그인 계정이 변경되었습니다. 이 기록을 다시 열어 주세요.");
      }
      if (!Number.isSafeInteger(next.currentVersion) || next.currentVersion < 1 || !["normal", "sensitive", "restricted"].includes(next.privacyLevel) || typeof body.contentReadable !== "boolean") throw new Error("서버 보호 정책 응답을 확인하지 못했습니다.");
      if (!await store.observeServerPolicy(next)) throw new Error("다른 창의 더 최신 보호 정책을 확인해야 합니다.");
      if (!mounted.current || attempt !== verification.current) throw new Error("편집 화면의 보호 정책을 다시 확인해 주세요.");
      // A privacy increase never inherits normal-mode consent for sensitive content.
      if (next.privacyLevel !== policyRef.current.privacyLevel && next.privacyLevel !== "normal") {
        enabledRef.current = false; consentEpoch.current += 1; setEnabled(false);
      }
      session.refreshPolicy(next);
      policyRef.current = next; setPolicy(next);
      if (!body.contentReadable) { accessDenied.current(); throw new Error("제한된 기록을 다시 인증해 주세요."); }
      readyRef.current = true; setReady(true);
      return next;
    } finally { clearTimeout(timeout); }
  }, [identity.ownerId, identity.recordId, store, session]);

  const persist = useCallback(async (copy: LinkWorkingCopy) => {
    if (!readyRef.current || !enabledRef.current || policyRef.current.privacyLevel === "restricted") return false;
    const currentPolicy = policyRef.current;
    const attempt = verification.current, consentVersion = consentEpoch.current;
    const controller = new AbortController(); persistence.current.add(controller);
    try {
      const saved = await store.put({ ...copy, payload: parse(copy.payload), baseVersion: currentPolicy.currentVersion, privacyLevel: currentPolicy.privacyLevel }, currentPolicy.privacyLevel === "sensitive", controller.signal);
      if (!readyRef.current || !enabledRef.current || attempt !== verification.current || consentVersion !== consentEpoch.current) return false;
      if (mounted.current && session.snapshot() === copy) setStatus(saved ? "이 기기에 초안 저장됨 · 서버 저장 전" : "기기 복구 사본을 저장하지 못했습니다. 다른 창의 보호 설정을 확인해 주세요.");
      return saved;
    } catch {
      if (mounted.current && session.snapshot() === copy && attempt === verification.current && consentVersion === consentEpoch.current) setStatus("기기 저장에 실패했습니다. 저장 공간 또는 다른 편집 창을 확인해 주세요.");
      return false;
    } finally { persistence.current.delete(controller); }
  }, [store, session, parse]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (suspended.current) return false;
    const copy = session.snapshot();
    return copy ? persist(copy) : true;
  }, [session, persist]);

  useEffect(() => {
    if (!active) { readyRef.current = false; return; }
    if (identityKey !== initialIdentityKey) {
      readyRef.current = false; enabledRef.current = false; session.clear();
      // This guard rejects unsupported same-instance navigation; the parent keys by owner/record.
      queueMicrotask(() => { setCopies([]); setReady(false); setEnabled(false); accessDenied.current(); });
      return;
    }
    mounted.current = true;
    let live = true;
    async function check() {
      try {
        const checked = await verify();
        if (!live) return;
        await load(checked, enabledRef.current);
        if (suspended.current) setStatus("숨겨 둔 입력은 다시 열기를 선택한 뒤 표시합니다.");
        else if (session.snapshot()) await flush();
        else if (live) setStatus("기기 복구 준비됨");
      } catch (error) { if (live) setStatus(error instanceof Error ? error.message : "기기 복구 준비 실패"); }
    }
    void check();
    const focus = () => { void check(); };
    const visibility = () => { if (document.hidden) void flush(); else void check(); };
    const unload = (event: BeforeUnloadEvent) => { if (session.snapshot()) { void flush(); event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("beforeunload", unload);
    return () => {
      live = false; mounted.current = false; verification.current += 1;
      window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("beforeunload", unload);
      void flush();
    };
  }, [active, identityKey, initialIdentityKey, verify, load, flush, session]);

  /** Hide immediately after a failed content authorization. Do not flush with a
   * stale policy, delete durable input, or expose the concealed session on resume.
   * The user can explicitly reopen the in-memory input after fresh authorization,
   * including when durable storage is disabled or forbidden for restricted data. */
  const suspend = useCallback(() => {
    verification.current += 1; readyRef.current = false;
    for (const controller of persistence.current) controller.abort();
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    suspended.current = Boolean(session.snapshot());
    setHasSuspended(suspended.current); setReady(false); setCopies([]);
  }, [session]);
  useLayoutEffect(() => onLinkDraftAccessRevoked({ ownerId: identity.ownerId, recordId: identity.recordId }, suspend), [identity.ownerId, identity.recordId, suspend]);
  async function resumeSuspended(): Promise<T> {
    const initial = session.snapshot(), consentVersion = consentEpoch.current;
    if (!suspended.current || !initial) throw new Error("이 화면에서 숨긴 초안이 없습니다.");
    await verify();
    const current = session.snapshot();
    // verify may refresh only the storage policy/generation; editing stays blocked.
    if (!mounted.current || !readyRef.current || !suspended.current || consentVersion !== consentEpoch.current || !current
      || current.id !== initial.id || current.payload !== initial.payload || current.scopeKey !== initial.scopeKey)
      throw new Error("초안 또는 보호 설정이 변경되었습니다. 다시 확인해 주세요.");
    const value = parse(current.payload);
    suspended.current = false; setHasSuspended(false);
    setStatus("이 화면의 숨긴 입력을 다시 열었습니다. 서버 저장은 하지 않았습니다.");
    return value;
  }

  function stage(payload: T, scopeKey: string) {
    if (identityKey !== initialIdentityKey) throw new Error("다른 계정·기록의 초안을 같은 편집 화면에 저장할 수 없습니다.");
    if (suspended.current) throw new Error("숨겨 둔 입력의 복구를 먼저 확인해 주세요. 새 입력으로 덮어쓰지 않았습니다.");
    const token = session.stage(payload, scopeKey, policyRef.current);
    setStatus("기기 초안 저장 대기");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 300);
    return token;
  }
  async function park() {
    if (suspended.current) throw new Error("숨긴 입력을 먼저 다시 열어 주세요. 다른 초안으로 이동하지 않았습니다.");
    const attempt = verification.current, consentVersion = consentEpoch.current;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!await session.park(persist)) throw new Error("현재 입력의 기기 사본을 보존하지 못했습니다. 다른 초안으로 이동하지 않았습니다.");
    if (mounted.current) await load(policyRef.current, enabledRef.current);
    if (!mounted.current || session.snapshot() || !readyRef.current || !enabledRef.current || attempt !== verification.current || consentVersion !== consentEpoch.current) throw new Error("초안 보존 중 입력 또는 보호 설정이 변경되어 편집 전환을 멈췄습니다. 입력은 유지했습니다.");
  }
  async function restore(row: DraftRow<T>): Promise<T> {
    if (suspended.current) throw new Error("숨긴 입력을 먼저 다시 열어 주세요.");
    const initial = session.snapshot(), consentVersion = consentEpoch.current;
    const checked = await verify();
    const attempt = verification.current;
    const current = (await load(checked, enabledRef.current)).find((copy) => copy.id === row.id && copy.generation === row.generation);
    if (!current) throw new Error("이 초안은 변경되었거나 보호 설정으로 복구할 수 없습니다.");
    if (session.snapshot() !== initial) throw new Error("복구 확인 중 현재 입력이 변경되었습니다. 복구할 초안을 다시 선택해 주세요.");
    await park();
    // The target may have been deleted or consent revoked while the current draft was parked.
    const refreshed = (await load(checked, enabledRef.current)).find((copy) => copy.id === row.id && copy.generation === row.generation);
    if (!refreshed || !mounted.current || !readyRef.current || !enabledRef.current || attempt !== verification.current || consentVersion !== consentEpoch.current) throw new Error("복구 확인 중 초안 또는 보호 설정이 변경되었습니다. 현재 입력은 보존했습니다.");
    session.restore(refreshed, refreshed.payload, policyRef.current);
    setStatus("기기 초안 저장 대기");
    timer.current = setTimeout(() => void flush(), 300);
    return refreshed.payload;
  }
  async function saved(token: LinkDraftSaveToken) {
    await session.saved(token, (id, generation) => store.remove(id, generation));
    if (mounted.current) { if (!session.snapshot()) setStatus("서버에 저장한 기기 사본 정리 완료"); await load(policyRef.current, enabledRef.current); }
  }
  async function discard(row: DraftRow<T>) {
    await store.remove(row.id, row.generation);
    if (mounted.current) setCopies((current) => current.filter((copy) => copy.id !== row.id || copy.generation !== row.generation));
  }
  async function consent(value: boolean) {
    consentEpoch.current += 1;
    enabledRef.current = value; setEnabled(value); setCopies([]);
    setStatus(value ? "기기 복구 동의 확인 중" : "기기 사본 정리 중");
    if (!value) {
      // Keep the in-memory draft editable; a future explicit opt-in uses a fresh generation.
      await session.disable((id, generation) => store.remove(id, generation));
      setStatus("이 화면의 기기 복구를 껐습니다. 다른 탭의 사본은 변경하지 않았습니다.");
      return;
    }
    const checked = await verify();
    await load(checked, value);
    await flush();
  }
  return { copies, status, policy, ready, enabled, hasSuspended,
    canPersist: ready && enabled && !hasSuspended && policy.privacyLevel !== "restricted", stage, flush, park, restore, saved, discard, consent, suspend, resumeSuspended };
}
