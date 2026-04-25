import type { ReactNode } from "react";

import { VaultHydrator } from "@/components/vault/vault-hydrator";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export default async function VaultLayout({ children }: { children: ReactNode }) {
  await seedVaultSupportData();
  const snapshot = await getVaultSnapshot();

  return (
    <>
      <VaultHydrator initialSnapshot={snapshot} />
      {children}
    </>
  );
}
