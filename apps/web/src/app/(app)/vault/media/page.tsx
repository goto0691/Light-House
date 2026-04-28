import { MediaClient } from "@/components/vault/media-client";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function MediaPage() {
  const savedViews = await listSavedViews({ domain: "media", scope: "items" });
  return <MediaClient savedViews={savedViews} />;
}
