import type { ReactNode } from "react";

import { LifeOpsHydrator } from "@/components/life-ops/life-ops-hydrator";
import { seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function LifeOpsLayout({ children }: { children: ReactNode }) {
  await seedLifeOpsSupportData();

  return (
    <LifeOpsHydrator>
      {children}
    </LifeOpsHydrator>
  );
}
