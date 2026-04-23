import "server-only";

import { ulid } from "ulidx";

import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = NotificationItem;
type CountRow = { total: number | null };

function isMissingTable(error: unknown) {
  return error instanceof Error && /no such table: notifications/i.test(error.message);
}

export async function listNotifications(options?: { unreadOnly?: boolean; limit?: number }) {
  const user = await resolveCurrentUser();
  const limit = options?.limit ?? 10;

  try {
    const result = await queryD1<NotificationRow>(
      `select
         id,
         kind,
         title,
         body,
         entity_type as entityType,
         entity_id as entityId,
         read_at as readAt,
         created_at as createdAt
       from notifications
       where user_id = ?
         ${options?.unreadOnly ? "and read_at is null" : ""}
       order by created_at desc
       limit ?`,
      [user.id, limit],
    );

    return result.rows;
  } catch (error) {
    if (isMissingTable(error)) {
      return [];
    }
    throw error;
  }
}

export async function getUnreadNotificationCount() {
  const user = await resolveCurrentUser();

  try {
    const result = await queryD1<CountRow>(
      `select count(*) as total
       from notifications
       where user_id = ? and read_at is null`,
      [user.id],
    );

    return Number(result.rows[0]?.total ?? 0);
  } catch (error) {
    if (isMissingTable(error)) {
      return 0;
    }
    throw error;
  }
}

export async function createNotification(input: {
  userId?: string;
  kind: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}) {
  const user = input.userId ? { id: input.userId } : await resolveCurrentUser();

  try {
    await executeD1(
      `insert into notifications
        (id, user_id, kind, title, body, entity_type, entity_id, read_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, null, datetime('now'))`,
      [ulid(), user.id, input.kind, input.title, input.body ?? null, input.entityType ?? null, input.entityId ?? null],
    );
  } catch (error) {
    if (isMissingTable(error)) {
      return;
    }
    throw error;
  }
}

export async function markNotificationRead(id: string) {
  const user = await resolveCurrentUser();

  try {
    await executeD1(
      `update notifications
       set read_at = datetime('now')
       where id = ? and user_id = ?`,
      [id, user.id],
    );
  } catch (error) {
    if (isMissingTable(error)) {
      return;
    }
    throw error;
  }
}

export async function markAllNotificationsRead() {
  const user = await resolveCurrentUser();

  try {
    await executeD1(
      `update notifications
       set read_at = datetime('now')
       where user_id = ? and read_at is null`,
      [user.id],
    );
  } catch (error) {
    if (isMissingTable(error)) {
      return;
    }
    throw error;
  }
}

