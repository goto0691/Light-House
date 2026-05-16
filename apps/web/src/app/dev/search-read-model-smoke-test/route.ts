import { handleSearchReadModelSmokeTest } from "@/lib/server/search-read-model-smoke-test";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSearchReadModelSmokeTest(request);
}
