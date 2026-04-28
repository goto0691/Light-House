import { redirect } from "next/navigation";

export default function DiariesPage() {
  redirect("/life-ops/entries?view=journal");
}
