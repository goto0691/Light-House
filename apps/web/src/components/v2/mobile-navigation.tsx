"use client";

import { Activity, Archive, Bookmark, Compass, ListChecks, MoreHorizontal, NotebookTabs, Plus, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import "./mobile-navigation.css";

const destinations = [
  { key: "review", href: "/v2/review", label: "확인할 내용", Icon: ListChecks },
  { key: "views", href: "/v2/library/views", label: "내 목록", Icon: Bookmark },
  { key: "templates", href: "/v2/library/templates", label: "템플릿", Icon: NotebookTabs },
  { key: "processing", href: "/v2/processing", label: "처리 상태", Icon: Activity },
  { key: "settings", href: "/settings", label: "설정", Icon: Settings },
] as const;

export function V2MobileNavigation({ active, moreHrefOverrides }: {
  active?: "library" | "search" | "explore";
  /** Static destinations supplied by trusted application/fixture callers, never user or AI data. */
  moreHrefOverrides?: Partial<Record<"review" | "views" | "templates" | "processing" | "settings", string>>;
}) {
  const router = useRouter(), id = useId();
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const historyEntry = useRef(false), historyOwner = useRef<string | null>(null), closing = useRef(false), destination = useRef<string | null>(null);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledNavigation = useCallback(() => {
    if (navigationTimer.current !== null) clearTimeout(navigationTimer.current);
    navigationTimer.current = null;
  }, []);
  useEffect(() => {
    // A lifetime token distinguishes a live Forward entry from a prior mount/reload.
    historyOwner.current ??= crypto.randomUUID();
    function removeOrphan() {
      if (!Object.hasOwn(history.state ?? {}, "lightHouseMore")) return;
      const restored = { ...history.state }; delete restored.lightHouseMore; history.replaceState(restored, "", location.href);
    }
    removeOrphan();
    function restore() {
      cancelScheduledNavigation();
      if (history.state?.lightHouseMore === historyOwner.current) {
        historyEntry.current = true; closing.current = false; destination.current = null; setOpen(true); return;
      }
      removeOrphan();
      if (!historyEntry.current) return;
      historyEntry.current = false; closing.current = false; dialog.current?.close(); setOpen(false); trigger.current?.focus();
      const next = destination.current; destination.current = null;
      // A new task runs after native popstate dispatch; microtasks can run between its listeners.
      if (next) navigationTimer.current = setTimeout(function completeMoreNavigation() { navigationTimer.current = null; router.push(next); }, 0);
    }
    window.addEventListener("popstate", restore);
    return () => {
      cancelScheduledNavigation();
      window.removeEventListener("popstate", restore);
      if (history.state?.lightHouseMore === historyOwner.current) removeOrphan();
    };
  }, [router, cancelScheduledNavigation]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; dialog.current?.showModal(); closeButton.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  function show() {
    cancelScheduledNavigation();
    if (open) return;
    historyOwner.current ??= crypto.randomUUID();
    history.pushState({ ...history.state, lightHouseMore: historyOwner.current }, "", location.href); historyEntry.current = true; closing.current = false; setOpen(true);
  }
  function close(next: string | null = null) {
    cancelScheduledNavigation();
    if (closing.current) return;
    destination.current = next;
    if (historyEntry.current && history.state?.lightHouseMore === historyOwner.current) { closing.current = true; history.back(); return; }
    dialog.current?.close(); setOpen(false); trigger.current?.focus(); destination.current = null; if (next) router.push(next);
  }
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); close(href);
  }
  return <>
    <nav aria-label="모바일 탐색" className="v2-mobile-navigation">
      <Link aria-current={active === "library" ? "page" : undefined} href="/v2/library"><Archive aria-hidden="true" size={19} /><span>보관함</span></Link>
      <Link aria-current={active === "search" ? "page" : undefined} href="/v2/search"><Search aria-hidden="true" size={19} /><span>검색</span></Link>
      <Link className="is-new" href="/v2/capture"><Plus aria-hidden="true" size={21} /><span>새 기록</span></Link>
      <Link aria-current={active === "explore" ? "page" : undefined} href="/v2/explore"><Compass aria-hidden="true" size={19} /><span>탐색</span></Link>
      <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-dialog`} onClick={show}><MoreHorizontal aria-hidden="true" size={19} /><span>더보기</span></button>
    </nav>
    {open ? <dialog ref={dialog} id={`${id}-dialog`} aria-labelledby={`${id}-title`} className="v2-mobile-more" onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:enabled,a[href]")], first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><header><h2 id={`${id}-title`}>더보기</h2><button ref={closeButton} type="button" aria-label="더보기 닫기" onClick={() => close()}><X aria-hidden="true" size={20} /></button></header>
      <nav aria-label="보조 메뉴">{destinations.map(({ key, href: defaultHref, label, Icon }) => {
        const href = moreHrefOverrides?.[key] ?? defaultHref;
        return <Link key={key} href={href} onClick={(event) => navigate(event, href)}><Icon aria-hidden="true" size={20} /><span>{label}</span></Link>;
      })}</nav>
    </dialog> : null}
  </>;
}
