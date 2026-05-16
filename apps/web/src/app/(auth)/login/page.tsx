import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,_rgba(251,191,36,0.08),_transparent_48%)]" />
      <section className="glass-elevated relative z-10 w-full max-w-md rounded-lg p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">Project Light House</p>
        <h1 className="mt-4 text-3xl font-semibold text-foreground">로그인</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          개인 작업 공간에 안전하게 들어갑니다. 오늘의 기록, 지식금고, 작업 흐름을 이어서 확인할 수 있습니다.
        </p>
        <LoginForm />
        <div className="mt-6 rounded-lg border border-white/10 bg-white/5 p-4 text-xs text-muted-foreground">
          기본 계정: <span className="text-foreground">keeper@lighthouse.local</span>
          <br />
          기본 비밀번호: <span className="text-foreground">lighthouse</span>
        </div>
      </section>
    </main>
  );
}
