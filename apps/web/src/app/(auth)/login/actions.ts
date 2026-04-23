"use server";

import { redirect } from "next/navigation";

import { createSession } from "@/lib/auth/session";
import { authenticateUser } from "@/lib/server/auth";

export type LoginActionState = {
  error?: string;
};

export async function loginAction(_: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "이메일과 비밀번호를 모두 입력해 주세요." };
  }

  const user = await authenticateUser(email, password);
  if (!user) {
    return { error: "계정 정보가 일치하지 않습니다." };
  }

  await createSession({
    userId: user.id,
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  const { clearSession } = await import("@/lib/auth/session");
  await clearSession();
  redirect("/login");
}
