"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Suspense, useEffect, useId, type ComponentType } from "react";

import { resolvePresentedContextModule, type PresentedContextModule } from "@/lib/v2/presentation/extension-registry";
import type { PresentedField } from "@/lib/v2/presentation/record-presentation";
import "./record-context-modules.css";

type FallbackReason = "invalid" | "version" | "render";

function ModuleFallback({ reason, onRetry }: { reason: FallbackReason; onRetry?: () => void }) {
  useEffect(() => {
    // Do not log errors, projections, labels or values: they can contain private writing.
    if (process.env.NODE_ENV === "development") console.warn(`[Light House] context-module:${reason}`);
  }, [reason]);
  return <section aria-label="맞춤 보기 안내" className="v2-context-module-notice" data-module-state="fallback">
    <h2>맞춤 보기를 표시하지 못했습니다</h2>
    <p>본문과 기본 정보는 계속 읽을 수 있습니다. {reason === "version" ? "현재 앱과 보기 형식이 맞지 않습니다." : "이 보기만 건너뛰었습니다."}</p>
    {onRetry ? <button type="button" onClick={onRetry}>맞춤 보기 다시 시도</button> : null}
  </section>;
}

/** Scope recovery to this optional view; never put the document or generic fields here. */
const ModuleErrorBoundary = catchError((_props: unknown, { retry }: ErrorInfo) => <ModuleFallback reason="render" onRetry={retry} />);

function FullModule({ module, Field }: { module: PresentedContextModule; Field: ComponentType<{ field: PresentedField }> }) {
  const headingId = useId();
  return <section aria-labelledby={headingId} className="v2-context-module v2-context-module-safe" data-module-key={module.moduleKey} data-module-state="full">
    <header><div><p>이 기록에 맞춘 보기</p><h2 id={headingId}>{module.title}</h2></div><span>{module.sourceLabels.join(" · ")}</span></header>
    <div>{module.fields.map((field) => <Field field={field} key={field.propertyId} />)}</div>
  </section>;
}

function ResolvedModule({ result, Field }: { result: ReturnType<typeof resolvePresentedContextModule>; Field: ComponentType<{ field: PresentedField }> }) {
  if (result.kind === "omit") return null;
  if (result.kind === "fallback") return <ModuleFallback reason={result.reason} />;
  if (result.kind === "redacted") return <section aria-label="민감한 기록의 맞춤 보기" className="v2-context-module-notice" data-module-state="redacted">
    <h2>맞춤 보기 미리보기를 숨겼습니다</h2><p>민감한 기록의 값과 출처는 이 요약에 표시하지 않습니다. 본문과 기본 정보에서 확인할 수 있습니다.</p>
  </section>;
  return <FullModule module={result.module} Field={Field} />;
}

export function RecordContextModules({ modules, Field }: { modules: unknown; Field: ComponentType<{ field: PresentedField }> }) {
  if (!Array.isArray(modules) || modules.length > 32) return <ModuleFallback reason="invalid" />;
  const seen = new Set<string>();
  return <>{modules.map((value: unknown, index: number) => {
    let result: ReturnType<typeof resolvePresentedContextModule>;
    try { result = resolvePresentedContextModule(value); } catch { result = { kind: "fallback", reason: "invalid" }; }
    if (result.kind === "omit") return null;
    const key = result.kind === "ready" ? result.module.moduleKey : result.kind === "redacted" ? result.moduleKey : `fallback-${index}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return <Suspense key={key} fallback={<ModuleFallback reason="render" />}>
      <ModuleErrorBoundary><ResolvedModule result={result} Field={Field} /></ModuleErrorBoundary>
    </Suspense>;
  })}</>;
}
