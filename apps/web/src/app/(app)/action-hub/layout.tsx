import type { ReactNode } from "react";

import { ActionHubHydrator } from "@/components/action-hub/action-hub-hydrator";

export default function ActionHubLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ActionHubHydrator />
      {children}
    </>
  );
}
