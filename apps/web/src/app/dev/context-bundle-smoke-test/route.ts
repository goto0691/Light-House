import { handleContextBundleSmokeTest } from "@/lib/server/context-bundle-smoke-test";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleContextBundleSmokeTest(request);
}
