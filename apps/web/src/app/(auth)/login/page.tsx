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
          개인 보관함의 관리자 계정으로 로그인하세요.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
