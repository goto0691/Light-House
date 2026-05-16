import { GiftsBoardClient } from "@/components/prm/gifts-board-client";
import { getPRMGifts, getPRMPeople } from "@/lib/server/prm";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function GiftsPage() {
  const [savedViews, people, gifts] = await Promise.all([
    listSavedViews({ domain: "gifts", scope: "relationships" }),
    getPRMPeople(),
    getPRMGifts(),
  ]);

  return <GiftsBoardClient gifts={gifts.rows} people={people} savedViews={savedViews} />;
}
