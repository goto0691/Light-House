import type { ReactNode } from "react";

import { PRMHydrator } from "@/components/prm/prm-hydrator";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";

export default async function PRMLayout({ children }: { children: ReactNode }) {
  await seedPRMSupportData();
  const snapshot = await getPRMSnapshot();

  return (
    <PRMHydrator initialSnapshot={snapshot}>
      {children}
    </PRMHydrator>
  );
}
