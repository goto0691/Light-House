"use client";

import { ErrorState } from "@/components/shared/error-state";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <ErrorState description={error.message || "잠시 후 다시 시도해 주세요. 문제가 계속되면 오류 ID를 함께 남겨주시면 흐름을 더 빨리 복구할 수 있습니다."} errorId={error.digest} onRetry={reset} />
    </div>
  );
}
