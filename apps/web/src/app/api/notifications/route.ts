import { NextResponse } from "next/server";

import { getUnreadNotificationCount, listNotifications, markAllNotificationsRead } from "@/lib/server/notifications";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unreadOnly") === "1";
  const limit = Number(searchParams.get("limit") ?? "10");

  const [items, unreadCount] = await Promise.all([
    listNotifications({ unreadOnly, limit }),
    getUnreadNotificationCount(),
  ]);

  return NextResponse.json({ items, unreadCount });
}

export async function POST() {
  await markAllNotificationsRead();
  const [items, unreadCount] = await Promise.all([
    listNotifications({ unreadOnly: false, limit: 10 }),
    getUnreadNotificationCount(),
  ]);

  return NextResponse.json({ items, unreadCount });
}

