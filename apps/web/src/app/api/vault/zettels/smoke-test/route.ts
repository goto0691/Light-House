import { handleZettelMutationSmokeTest } from "@/lib/server/zettel-smoke-test";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleZettelMutationSmokeTest(request);
}

export async function POST(request: Request) {
  return handleZettelMutationSmokeTest(request);
}
