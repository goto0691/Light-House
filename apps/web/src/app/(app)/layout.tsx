import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/auth/session";
import { resolveCurrentUser } from "@/lib/server/session-user";

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  await requireSession();
  const user = await resolveCurrentUser();
  return <AppShell glassOpacity={user.preferences.glassOpacity}>{children}</AppShell>;
}
