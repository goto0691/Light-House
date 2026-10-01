"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function PwaRegistration({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<"disabled" | "unsupported" | "registering" | "ready" | "update_ready" | "failed">(enabled ? "registering" : "disabled");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const applyRequestedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (!("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }
    let active = true;
    const updateState = (registration: ServiceWorkerRegistration) => {
      if (!active) return;
      registrationRef.current = registration;
      setStatus(registration.waiting ? "update_ready" : "ready");
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller && active) setStatus("update_ready");
        });
      });
    };
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(updateState).catch(() => {
      if (active) setStatus("failed");
    });
    const reload = () => {
      if (applyRequestedRef.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reload);
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", reload);
    };
  }, [enabled]);

  if (status !== "update_ready") return <span aria-hidden="true" data-pwa-registration={status} hidden />;
  return (
    <aside className="v2-pwa-update" role="status">
      <span>새 버전이 준비됐습니다. 이 기기의 임시 기록은 유지됩니다.</span>
      <button onClick={() => { applyRequestedRef.current = true; registrationRef.current?.waiting?.postMessage({ type: "SKIP_WAITING" }); }} type="button"><RefreshCw aria-hidden="true" size={14} /> 업데이트</button>
    </aside>
  );
}
