import { handleVaultDeltaSmokeTest } from "@/lib/server/vault-delta-smoke-test";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleVaultDeltaSmokeTest(request);
}

export async function POST(request: Request) {
  return handleVaultDeltaSmokeTest(request);
}
