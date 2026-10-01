import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/auth/session";
import { resolveCurrentUser } from "@/lib/server/session-user";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  await requireSession();
  const user = await resolveCurrentUser();
  const flags = getV2ServerFeatureFlags();
  return <AppShell defaultLibrary={flags.routes && flags.defaultLibrary} glassOpacity={user.preferences.glassOpacity} legacyReadonly={flags.legacyReadonly} v2Capture={flags.routes && flags.write}>{children}</AppShell>;
}
