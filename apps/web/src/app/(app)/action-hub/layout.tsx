import type { ReactNode } from "react";

import { ActionHubHydrator } from "@/components/action-hub/action-hub-hydrator";
import { seedActionHubSupportData } from "@/lib/server/action-hub";

export default async function ActionHubLayout({ children }: { children: ReactNode }) {
  await seedActionHubSupportData();

  return (
    <ActionHubHydrator>
      {children}
    </ActionHubHydrator>
  );
}
