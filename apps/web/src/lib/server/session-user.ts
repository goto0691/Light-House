import "server-only";

import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

export type UserPreferences = {
  theme: "dark" | "light" | "system";
  glassOpacity: "full" | "low" | "off";
  aiEnabled: boolean;
  aiRoutingThreshold: number;
  aiFallbackModel: string;
};

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  timezone: string;
  preferences: UserPreferences;
};

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  locale: string | null;
  timezone: string | null;
  preferences: string | null;
};

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "system",
  glassOpacity: "full",
  aiEnabled: true,
  aiRoutingThreshold: 0.7,
  aiFallbackModel: "gemini-3.1-flash-lite-preview",
};

function parsePreferences(value: string | null) {
  if (!value) return DEFAULT_PREFERENCES;

  try {
    const parsed = JSON.parse(value) as Partial<UserPreferences>;
    return {
      theme: parsed.theme ?? DEFAULT_PREFERENCES.theme,
      glassOpacity: parsed.glassOpacity ?? DEFAULT_PREFERENCES.glassOpacity,
      aiEnabled: parsed.aiEnabled ?? DEFAULT_PREFERENCES.aiEnabled,
      aiRoutingThreshold: parsed.aiRoutingThreshold ?? DEFAULT_PREFERENCES.aiRoutingThreshold,
      aiFallbackModel: parsed.aiFallbackModel ?? DEFAULT_PREFERENCES.aiFallbackModel,
    } satisfies UserPreferences;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function resolveCurrentUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const found = await queryD1<UserRow>(
    `select
       id,
       email,
       display_name as displayName,
       locale,
       timezone,
       preferences
     from users
     where id = ?
     limit 1`,
    [session.userId],
  );

  const existing = found.rows[0];
  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      displayName: existing.displayName,
      locale: existing.locale ?? "ko-KR",
      timezone: existing.timezone ?? "Asia/Seoul",
      preferences: parsePreferences(existing.preferences),
    };
  }

  await executeD1(
    `insert into users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
     values (?, ?, ?, 'ko-KR', 'Asia/Seoul', ?, datetime('now'), datetime('now'))`,
    [session.userId, session.email, session.displayName, JSON.stringify(DEFAULT_PREFERENCES)],
  );

  return {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    locale: "ko-KR",
    timezone: "Asia/Seoul",
    preferences: DEFAULT_PREFERENCES,
  };
}

export async function updateCurrentUserProfile(input: { displayName: string; locale: string; timezone: string }) {
  const user = await resolveCurrentUser();
  const displayName = input.displayName.trim();

  if (!displayName) {
    throw new Error("표시 이름은 비워둘 수 없습니다.");
  }

  await executeD1(
    `update users
     set display_name = ?, locale = ?, timezone = ?, updated_at = datetime('now')
     where id = ?`,
    [displayName, input.locale, input.timezone, user.id],
  );

  return resolveCurrentUser();
}

export async function updateCurrentUserPreferences(patch: Partial<UserPreferences>) {
  const user = await resolveCurrentUser();
  const merged: UserPreferences = {
    ...user.preferences,
    ...patch,
  };

  await executeD1(
    `update users
     set preferences = ?, updated_at = datetime('now')
     where id = ?`,
    [JSON.stringify(merged), user.id],
  );

  return resolveCurrentUser();
}
