import { redirect } from "next/navigation";

export default function MeditationsPage() {
  redirect("/life-ops/entries?view=meditation");
}
