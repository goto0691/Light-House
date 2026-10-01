export const V2_PROCESSING_CRON = "*/5 * * * *";
export const V2_BACKUP_MAINTENANCE_CRON = "20 18 * * *";

const ROUTES_BY_CRON: Readonly<Record<string, readonly string[]>> = {
  [V2_PROCESSING_CRON]: [
    "/api/v2/backups/maintenance",
    "/api/v2/restores/uploads/maintenance",
    "/api/v2/processing/run",
  ],
  [V2_BACKUP_MAINTENANCE_CRON]: ["/api/v2/backups/maintenance"],
};

export type ScheduledJobDispatch = (request: Request) => Promise<Response>;

export async function runV2ScheduledJobs(input: {
  cron: string;
  cronSecret?: string;
  dispatch: ScheduledJobDispatch;
}) {
  const routes = ROUTES_BY_CRON[input.cron] ?? [];
  if (!routes.length) return { cron: input.cron, triggered: 0 };

  const secret = input.cronSecret?.trim();
  if (!secret) throw new Error("CRON_SECRET is required for scheduled V2 jobs.");

  const failures: string[] = [];
  for (const route of routes) {
    try {
      const response = await input.dispatch(
        new Request(`https://scheduled.project-light-house.internal${route}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}` },
        }),
      );
      if (!response.ok) failures.push(`${route} (status ${response.status})`);
    } catch {
      failures.push(`${route} (dispatch error)`);
    }
  }

  if (failures.length) throw new Error(`Scheduled V2 jobs failed: ${failures.join(", ")}.`);

  return { cron: input.cron, triggered: routes.length };
}
