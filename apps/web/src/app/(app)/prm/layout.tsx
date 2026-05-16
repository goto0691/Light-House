import type { ReactNode } from "react";

import { PRMHydrator } from "@/components/prm/prm-hydrator";
import { seedPRMSupportData } from "@/lib/server/prm";

export default async function PRMLayout({ children }: { children: ReactNode }) {
  await seedPRMSupportData();

  return (
    <PRMHydrator>
      {children}
    </PRMHydrator>
  );
}
