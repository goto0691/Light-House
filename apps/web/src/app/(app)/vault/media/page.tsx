import { MediaClient } from "@/components/vault/media-client";
import { listSavedViews } from "@/lib/server/ui-state";
import { getVaultMediaList } from "@/lib/server/vault";

export default async function MediaPage() {
  const [media, savedViews] = await Promise.all([getVaultMediaList(), listSavedViews({ domain: "media", scope: "items" })]);
  return <MediaClient initialMedia={media} savedViews={savedViews} />;
}
