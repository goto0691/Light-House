import type { ReactNode } from "react";

import { ActionHubHydrator } from "@/components/action-hub/action-hub-hydrator";
import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";

export default async function ActionHubLayout({ children }: { children: ReactNode }) {
  await seedActionHubSupportData();
  const snapshot = await getActionHubSnapshot();

  return (
    <>
      <ActionHubHydrator initialSnapshot={snapshot} />
      {children}
    </>
  );
}
