"use client";

import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/(auth)/login/actions";

export function LogoutForm({ iconOnly = false, label = "로그아웃" }: { iconOnly?: boolean; label?: string }) {
  return (
    <form action={logoutAction}>
      <button
        className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
        type="submit"
      >
        {iconOnly ? <LogOut className="h-4 w-4" /> : label}
      </button>
    </form>
  );
}
