import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="glass max-w-md rounded-[24px] p-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">404</p>
        <h1 className="mt-4 text-3xl font-semibold text-foreground">길을 잃지 않게 다시 비춰 드릴게요.</h1>
        <p className="mt-3 text-sm text-muted-foreground">찾으시는 페이지를 아직 만들지 않았거나, 경로가 바뀌었습니다.</p>
        <Link className="mt-6 inline-flex rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href="/dashboard">
          Dashboard로 이동
        </Link>
      </div>
    </main>
  );
}
