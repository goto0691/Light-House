import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/auth/session";

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  await requireSession();
  return <AppShell>{children}</AppShell>;
}
