"use server";

import { redirect } from "next/navigation";

import { createSession } from "@/lib/auth/session";

export type LoginActionState = {
  error?: string;
};

function getAdminConfig() {
  return {
    email: process.env.LIGHT_HOUSE_ADMIN_EMAIL ?? "keeper@lighthouse.local",
    password: process.env.LIGHT_HOUSE_ADMIN_PASSWORD ?? "lighthouse",
    displayName: process.env.LIGHT_HOUSE_ADMIN_NAME ?? "Light Keeper",
  };
}

export async function loginAction(_: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const admin = getAdminConfig();

  if (!email || !password) {
    return { error: "이메일과 비밀번호를 모두 입력해 주세요." };
  }

  if (email !== admin.email || password !== admin.password) {
    return { error: "기본 관리자 계정과 일치하지 않습니다." };
  }

  await createSession({
    email: admin.email,
    displayName: admin.displayName,
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  const { clearSession } = await import("@/lib/auth/session");
  await clearSession();
  redirect("/login");
}
