import { describe, expect, test } from "vitest";

import { chooseAutomatedBackup, planBackupRetention, type RetentionSnapshot } from "@/lib/v2/portability/backup-retention-v1";

const row = (id: string, retentionClass: RetentionSnapshot["retentionClass"], day: number, extra: Partial<RetentionSnapshot> = {}): RetentionSnapshot => ({ id, baseSnapshotId: null, retentionClass, pinned: false, createdAt: `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`, ...extra });

describe("I7 backup retention policy", () => {
  test("retains 30 daily, 12 weekly, 12 monthly, manual and pinned snapshots plus chain ancestors", () => {
    const full = row("full-parent", "daily", 1);
    const daily = Array.from({ length: 31 }, (_, index) => row(`daily-${index}`, "daily", index + 1, index === 30 ? { baseSnapshotId: full.id } : {}));
    const weekly = Array.from({ length: 13 }, (_, index) => row(`weekly-${index}`, "weekly", index + 1));
    const monthly = Array.from({ length: 13 }, (_, index) => row(`monthly-${index}`, "monthly", index + 1));
    const manual = row("manual", "manual", 1);
    const pinnedOld = row("pinned-old", "daily", 1, { pinned: true });
    const plan = planBackupRetention([full, ...daily, ...weekly, ...monthly, manual, pinnedOld]);
    expect(plan.keep).toContain(full.id);
    expect(plan.keep).toContain(manual.id);
    expect(plan.keep).toContain(pinnedOld.id);
    expect(plan.prune).toContain("weekly-0");
    expect(plan.prune).toContain("monthly-0");
    expect(plan.prune).not.toContain("daily-30");
  });

  test("chooses a monthly full, then weekly full, then daily incremental, and skips duplicates", () => {
    const now = new Date("2026-08-12T09:00:00.000Z");
    expect(chooseAutomatedBackup([], now)).toEqual({ kind: "full", retentionClass: "monthly" });
    const monthly = [{ retentionClass: "monthly" as const, createdAt: "2026-08-01T00:00:00.000Z" }];
    expect(chooseAutomatedBackup(monthly, now)).toEqual({ kind: "full", retentionClass: "weekly" });
    const weekly = [...monthly, { retentionClass: "weekly" as const, createdAt: "2026-08-10T00:00:00.000Z" }];
    expect(chooseAutomatedBackup(weekly, now)).toEqual({ kind: "incremental", retentionClass: "daily" });
    expect(chooseAutomatedBackup([...weekly, { retentionClass: "daily" as const, createdAt: "2026-08-12T00:00:00.000Z" }], now)).toBeNull();
  });

  test("fails closed for missing ancestors, cycles, and unknown retention classes", () => {
    expect(() => planBackupRetention([row("leaf", "manual", 1, { baseSnapshotId: "missing" })])).toThrow("backup_retention_chain_missing_ancestor");
    expect(() => planBackupRetention([
      row("cycle-a", "manual", 1, { baseSnapshotId: "cycle-b" }),
      row("cycle-b", "daily", 2, { baseSnapshotId: "cycle-a" }),
    ])).toThrow("backup_retention_chain_cycle");
    expect(() => planBackupRetention([row("corrupt", "invalid" as RetentionSnapshot["retentionClass"], 1)])).toThrow("backup_retention_class_invalid");
  });
});
