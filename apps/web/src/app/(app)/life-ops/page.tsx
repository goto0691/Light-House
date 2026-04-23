import { redirect } from "next/navigation";

import { getTodayString } from "@/lib/mock/life-ops";

export default function LifeOpsPage() {
  redirect(`/life-ops/${getTodayString()}`);
}
