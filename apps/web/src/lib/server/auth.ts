import "server-only";

import { randomUUID } from "node:crypto";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  hashedPassword: string | null;
};

function getAdminConfig() {
  return {
    id: "user-light-keeper",
    email: process.env.LIGHT_HOUSE_ADMIN_EMAIL ?? "keeper@lighthouse.local",
    password: process.env.LIGHT_HOUSE_ADMIN_PASSWORD ?? "lighthouse",
    displayName: process.env.LIGHT_HOUSE_ADMIN_NAME ?? "Light Keeper",
  };
}

async function getUserByEmail(email: string) {
  const found = await queryD1<UserRow>(
    `select
       id,
       email,
       display_name as displayName,
       hashed_password as hashedPassword
     from users
     where email = ?
     limit 1`,
    [email],
  );

  return found.rows[0] ?? null;
}

export async function syncConfiguredAdminUser() {
  const admin = getAdminConfig();
  const existing = await getUserByEmail(admin.email);
  const hashedPassword = await hashPassword(admin.password);

  if (!existing) {
    await executeD1(
      `insert into users
        (id, email, display_name, hashed_password, locale, timezone, preferences, created_at, updated_at)
       values (?, ?, ?, ?, 'ko-KR', 'Asia/Seoul', '{"theme":"system"}', datetime('now'), datetime('now'))`,
      [admin.id, admin.email, admin.displayName, hashedPassword],
    );

    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      hashedPassword,
    } satisfies UserRow;
  }

  const needsPasswordRefresh = !existing.hashedPassword || !(await verifyPassword(admin.password, existing.hashedPassword));
  const needsDisplayRefresh = existing.displayName !== admin.displayName;

  if (needsPasswordRefresh || needsDisplayRefresh) {
    await executeD1(
      `update users
       set display_name = ?, hashed_password = ?, updated_at = datetime('now')
       where id = ?`,
      [admin.displayName, hashedPassword, existing.id],
    );

    return {
      ...existing,
      displayName: admin.displayName,
      hashedPassword,
    } satisfies UserRow;
  }

  return existing;
}

export async function authenticateUser(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const admin = getAdminConfig();

  if (normalizedEmail === admin.email) {
    await syncConfiguredAdminUser();
  }

  const user = await getUserByEmail(normalizedEmail);
  if (!user?.hashedPassword) {
    return null;
  }

  const isValid = await verifyPassword(password, user.hashedPassword);
  if (!isValid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

export function createSessionId() {
  return `sess_${randomUUID().replaceAll("-", "")}`;
}
