"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="glass-elevated max-w-md rounded-[24px] p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-danger">System Error</p>
          <h1 className="mt-4 text-2xl font-semibold text-foreground">잠시 등대 불빛이 흔들렸습니다.</h1>
          <p className="mt-3 text-sm text-muted-foreground">{error.message}</p>
          <button
            className="mt-6 rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => reset()}
            type="button"
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
