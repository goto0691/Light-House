import { handleContextSearchSmokeTest } from "@/lib/server/context-search-smoke-test";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleContextSearchSmokeTest(request);
}
