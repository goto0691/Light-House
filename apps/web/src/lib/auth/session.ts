import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { createSessionId } from "@/lib/server/auth";

const SESSION_COOKIE = "lh_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type SessionRecord = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  expiresAt: number;
};

type SessionRow = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  expiresAt: number;
};

async function deleteSessionById(sessionId: string) {
  await executeD1("delete from sessions where id = ?", [sessionId]);
}

export async function createSession(input: { userId: string }) {
  const sessionId = createSessionId();
  const expiresAt = Date.now() + SESSION_TTL_MS;

  await executeD1(
    `insert into sessions (id, user_id, expires_at)
     values (?, ?, ?)`,
    [sessionId, input.userId, expiresAt],
  );

  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSession() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await deleteSessionById(sessionId);
  }
  store.delete(SESSION_COOKIE);
}

export async function getSession() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const found = await queryD1<SessionRow>(
    `select
       sessions.id as sessionId,
       users.id as userId,
       users.email as email,
       users.display_name as displayName,
       sessions.expires_at as expiresAt
     from sessions
     inner join users on users.id = sessions.user_id
     where sessions.id = ?
     limit 1`,
    [sessionId],
  );

  const session = found.rows[0];
  if (!session) {
    store.delete(SESSION_COOKIE);
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    await deleteSessionById(session.sessionId);
    store.delete(SESSION_COOKIE);
    return null;
  }

  return session satisfies SessionRecord;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
