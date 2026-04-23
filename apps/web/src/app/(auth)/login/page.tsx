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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.10),_transparent_30%)]" />
      <section className="glass-elevated relative z-10 w-full max-w-md rounded-[28px] p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">Project Light House</p>
        <h1 className="mt-4 text-3xl font-semibold text-foreground">로그인</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          P0에서는 단일 관리자 계정으로 진입하는 최소 인증 흐름을 먼저 연결했습니다. 이후 Lucia + D1 세션 저장소로 확장할 수 있게 구조를 잡아 두었습니다.
        </p>
        <LoginForm />
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-muted-foreground">
          기본 계정: <span className="text-foreground">keeper@lighthouse.local</span>
          <br />
          기본 비밀번호: <span className="text-foreground">lighthouse</span>
        </div>
      </section>
    </main>
  );
}
