import { PlacesClient } from "@/components/vault/places-client";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function PlacesPage() {
  const savedViews = await listSavedViews({ domain: "places", scope: "visits" });

  return <PlacesClient savedViews={savedViews} />;
}
