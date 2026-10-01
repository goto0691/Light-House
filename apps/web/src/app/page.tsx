import { redirect } from "next/navigation";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { resolveAuthenticatedHome } from "@/lib/v2/cutover/cutover-routing";

// The destination is controlled by Worker runtime flags and must remain
// switchable without rebuilding the application.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const flags = getV2ServerFeatureFlags();
  redirect(resolveAuthenticatedHome(flags));
}
