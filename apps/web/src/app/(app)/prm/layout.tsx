import type { ReactNode } from "react";

import { PRMHydrator } from "@/components/prm/prm-hydrator";

export default function PRMLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PRMHydrator />
      {children}
    </>
  );
}
