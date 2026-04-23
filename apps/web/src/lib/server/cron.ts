import "server-only";

import { ulid } from "ulidx";

import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { generateAISummary } from "@/lib/server/ai";
import { seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { createNotification } from "@/lib/server/notifications";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";
import { resolveCurrentUser } from "@/lib/server/session-user";
import { seedVaultSupportData } from "@/lib/server/vault";

export type CronJob = "hit_them_up" | "daily_backup" | "weekly_review" | "birthday" | "hard_delete";

function daysUntilBirthday(value: string | undefined) {
  if (!value) return null;
  const [month, day] = value.split("-").map(Number);
  const now = new Date();
  const currentYear = now.getFullYear();
  const next = new Date(currentYear, month - 1, day);
  if (next < now) {
    next.setFullYear(currentYear + 1);
  }
  return Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

async function writeAuditLog(userId: string, action: string, entityId: string, snapshot: string) {
  await executeD1(
    `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [ulid(), userId, action, "system", entityId, snapshot],
  );
}

export async function runCronJob(job: CronJob) {
  const user = await resolveCurrentUser();
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);

  if (job === "hit_them_up") {
    const snapshot = await getPRMSnapshot();
    const overdue = snapshot.people
      .filter((person) => person.daysSinceContact > person.cadenceDays)
      .map((person) => `${person.name} (${person.daysSinceContact}일)`);
    const summary = overdue.length ? `연락 overdue ${overdue.length}명` : "연락 overdue 인물이 없습니다.";
    if (overdue.length) {
      await createNotification({
        userId: user.id,
        kind: "hit_them_up",
        title: `연락이 밀린 인물 ${overdue.length}명`,
        body: overdue.slice(0, 5).join(", "),
        entityType: "person",
        entityId: "hit-them-up",
      });
    }
    await writeAuditLog(user.id, "cron.hit_them_up", job, JSON.stringify({ summary, overdue }));
    return { job, summary, details: overdue };
  }

  if (job === "daily_backup") {
    const counts = await Promise.all([
      queryD1<{ total: number | null }>(`select count(*) as total from projects where user_id = ? and deleted_at is null`, [user.id]),
      queryD1<{ total: number | null }>(`select count(*) as total from tasks where user_id = ? and deleted_at is null`, [user.id]),
      queryD1<{ total: number | null }>(`select count(*) as total from zettels where user_id = ?`, [user.id]),
    ]);
    const summary = process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID ? "R2 백업 대상 메타를 기록했습니다." : "R2 자격증명이 없어 로컬 백업 메타만 기록했습니다.";
    const details = [
      `projects=${Number(counts[0].rows[0]?.total ?? 0)}`,
      `tasks=${Number(counts[1].rows[0]?.total ?? 0)}`,
      `zettels=${Number(counts[2].rows[0]?.total ?? 0)}`,
    ];
    await writeAuditLog(user.id, "cron.daily_backup", job, `${summary} | ${details.join(", ")}`);
    return { job, summary, details };
  }

  if (job === "weekly_review") {
    const markdown = await generateAISummary({ type: "weekly" });
    const details = markdown.split("\n").slice(0, 6).filter(Boolean);
    const summary = "주간 회고를 생성했습니다.";
    await createNotification({
      userId: user.id,
      kind: "ai_summary_ready",
      title: "주간 회고가 준비됐습니다.",
      body: details.join(" / "),
      entityType: "weekly_review",
      entityId: job,
    });
    await writeAuditLog(user.id, "cron.weekly_review", job, markdown);
    return { job, summary, details };
  }

  if (job === "birthday") {
    const snapshot = await getPRMSnapshot();
    const upcoming = snapshot.people
      .map((person) => ({
        name: person.name,
        days: daysUntilBirthday(person.upcomingBirthday),
      }))
      .filter((item) => item.days !== null && item.days <= 7)
      .sort((a, b) => Number(a.days) - Number(b.days));
    const summary = upcoming.length ? `7일 내 생일 ${upcoming.length}명` : "7일 내 생일이 없습니다.";
    const details = upcoming.map((item) => `${item.name} (${item.days}일 남음)`);
    if (details.length) {
      await createNotification({
        userId: user.id,
        kind: "birthday",
        title: `곧 생일인 인물 ${details.length}명`,
        body: details.join(", "),
        entityType: "person",
        entityId: "birthday-window",
      });
    }
    await writeAuditLog(user.id, "cron.birthday", job, JSON.stringify({ summary, upcoming }));
    return { job, summary, details };
  }

  const hardDeleteTargets = await Promise.all([
    executeD1(`delete from tasks where user_id = ? and deleted_at is not null and deleted_at <= datetime('now', '-90 day')`, [user.id]),
    executeD1(`delete from projects where user_id = ? and deleted_at is not null and deleted_at <= datetime('now', '-90 day')`, [user.id]),
  ]);
  const deletedTasks = Number(hardDeleteTargets[0].changes ?? 0);
  const deletedProjects = Number(hardDeleteTargets[1].changes ?? 0);
  const summary = `하드 삭제 정리 완료: tasks ${deletedTasks}, projects ${deletedProjects}`;
  const details = [`tasks=${deletedTasks}`, `projects=${deletedProjects}`];
  await writeAuditLog(user.id, "cron.hard_delete", job, summary);
  return { job, summary, details };
}
