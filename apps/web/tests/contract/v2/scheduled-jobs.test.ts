import { describe, expect, it, vi } from "vitest";

import {
  runV2ScheduledJobs,
  V2_BACKUP_MAINTENANCE_CRON,
  V2_PROCESSING_CRON,
} from "@/lib/v2/infrastructure/cloudflare/scheduled-jobs";

describe("V2 Cloudflare scheduled jobs", () => {
  it("dispatches every five-minute maintenance slice in a stable order", async () => {
    const routes: string[] = [];
    const dispatch = vi.fn(async (request: Request) => {
      routes.push(new URL(request.url).pathname);
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer test-cron-secret");
      return new Response(null, { status: 204 });
    });

    await expect(runV2ScheduledJobs({ cron: V2_PROCESSING_CRON, cronSecret: "test-cron-secret", dispatch })).resolves.toEqual({
      cron: V2_PROCESSING_CRON,
      triggered: 3,
    });
    expect(routes).toEqual([
      "/api/v2/backups/maintenance",
      "/api/v2/restores/uploads/maintenance",
      "/api/v2/processing/run",
    ]);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("dispatches the daily maintenance trigger", async () => {
    const dispatch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/api/v2/backups/maintenance");
      return new Response(null, { status: 204 });
    });
    await expect(runV2ScheduledJobs({ cron: V2_BACKUP_MAINTENANCE_CRON, cronSecret: "test-cron-secret", dispatch })).resolves.toEqual({
      cron: V2_BACKUP_MAINTENANCE_CRON,
      triggered: 1,
    });
  });

  it("does not dispatch unknown cron expressions", async () => {
    const dispatch = vi.fn();
    await expect(runV2ScheduledJobs({ cron: "0 0 1 1 *", dispatch })).resolves.toEqual({
      cron: "0 0 1 1 *",
      triggered: 0,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects configured jobs when the secret is missing", async () => {
    await expect(runV2ScheduledJobs({ cron: V2_PROCESSING_CRON, dispatch: vi.fn() })).rejects.toThrow(
      "CRON_SECRET is required",
    );
  });

  it("attempts later jobs and reports failures without exposing the secret", async () => {
    const secret = "do-not-log-this-secret";
    const routes: string[] = [];
    const dispatch = vi.fn(async (request: Request) => {
      const route = new URL(request.url).pathname;
      routes.push(route);
      if (route === "/api/v2/backups/maintenance") return new Response(null, { status: 503 });
      if (route === "/api/v2/restores/uploads/maintenance") throw new Error(`unsafe ${secret}`);
      return new Response(null, { status: 204 });
    });

    await expect(
      runV2ScheduledJobs({
        cron: V2_PROCESSING_CRON,
        cronSecret: secret,
        dispatch,
      }),
    ).rejects.toThrow("status 503");

    expect(routes).toEqual([
      "/api/v2/backups/maintenance",
      "/api/v2/restores/uploads/maintenance",
      "/api/v2/processing/run",
    ]);

    try {
      await runV2ScheduledJobs({
        cron: V2_PROCESSING_CRON,
        cronSecret: secret,
        dispatch,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("dispatch error");
    }
  });
});
