import { GiftsBoardClient } from "@/components/prm/gifts-board-client";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function GiftsPage() {
  const savedViews = await listSavedViews({ domain: "gifts", scope: "relationships" });

  return <GiftsBoardClient savedViews={savedViews} />;
}
