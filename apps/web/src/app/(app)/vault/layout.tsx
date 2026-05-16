import type { ReactNode } from "react";

import { VaultHydrator } from "@/components/vault/vault-hydrator";
import { seedVaultSupportData } from "@/lib/server/vault";

export default async function VaultLayout({ children }: { children: ReactNode }) {
  let initialError: string | undefined;

  try {
    await seedVaultSupportData();
  } catch (error) {
    initialError = getVaultBootstrapErrorMessage(error);
  }

  return (
    <VaultHydrator initialError={initialError}>
      {children}
    </VaultHydrator>
  );
}

function getVaultBootstrapErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : "알 수 없는 서버 오류가 발생했습니다.";
  return `서버에서 지식금고 데이터를 준비하지 못했습니다. ${detail}`;
}
