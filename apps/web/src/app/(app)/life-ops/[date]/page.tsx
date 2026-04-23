import { DailyLogClient } from "@/components/life-ops/daily-log-client";

export default async function DailyLogPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <DailyLogClient date={date} />;
}
