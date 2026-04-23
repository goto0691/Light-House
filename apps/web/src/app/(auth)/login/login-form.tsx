"use client";

import { useActionState } from "react";

import { loginAction, type LoginActionState } from "./actions";

const INITIAL_STATE: LoginActionState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <label className="block">
        <span className="mb-2 block text-sm text-foreground">이메일</span>
        <input
          autoComplete="email"
          className="input-base"
          defaultValue="keeper@lighthouse.local"
          name="email"
          type="email"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm text-foreground">비밀번호</span>
        <input
          autoComplete="current-password"
          className="input-base"
          defaultValue="lighthouse"
          name="password"
          type="password"
        />
      </label>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <button
        className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
        type="submit"
      >
        {pending ? "인증 중..." : "Dashboard 진입"}
      </button>
    </form>
  );
}
