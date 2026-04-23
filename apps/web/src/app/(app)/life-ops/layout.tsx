import type { ReactNode } from "react";

import { LifeOpsHydrator } from "@/components/life-ops/life-ops-hydrator";

export default function LifeOpsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LifeOpsHydrator />
      {children}
    </>
  );
}
