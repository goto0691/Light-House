import { NextResponse } from "next/server";

import { getUnreadNotificationCount, listNotifications, markNotificationRead } from "@/lib/server/notifications";

type RouteContext = {
  params: Promise<{
    notificationId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { notificationId } = await context.params;
  await markNotificationRead(notificationId);
  const [items, unreadCount] = await Promise.all([
    listNotifications({ unreadOnly: false, limit: 10 }),
    getUnreadNotificationCount(),
  ]);

  return NextResponse.json({ items, unreadCount });
}

