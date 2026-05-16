import { PlacesClient } from "@/components/vault/places-client";
import { listSavedViews } from "@/lib/server/ui-state";
import { getVaultPlaceList } from "@/lib/server/vault";

export default async function PlacesPage() {
  const [places, savedViews] = await Promise.all([getVaultPlaceList(), listSavedViews({ domain: "places", scope: "visits" })]);

  return <PlacesClient initialPlaces={places} savedViews={savedViews} />;
}
