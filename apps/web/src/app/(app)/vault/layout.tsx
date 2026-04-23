import type { ReactNode } from "react";

import { VaultHydrator } from "@/components/vault/vault-hydrator";

export default function VaultLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <VaultHydrator />
      {children}
    </>
  );
}
