import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "lh_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type SessionPayload = {
  email: string;
  displayName: string;
  expiresAt: number;
};

function getSessionSecret() {
  return process.env.LUCIA_SESSION_SECRET ?? "light-house-dev-session-secret";
}

function encodePayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(encoded: string) {
  const value = Buffer.from(encoded, "base64url").toString("utf8");
  return JSON.parse(value) as SessionPayload;
}

function signValue(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function makeToken(payload: SessionPayload) {
  const encoded = encodePayload(payload);
  return `${encoded}.${signValue(encoded)}`;
}

function verifyToken(token: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = signValue(encoded);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  const payload = decodePayload(encoded);
  if (payload.expiresAt <= Date.now()) return null;

  return payload;
}

export async function createSession(input: { email: string; displayName: string }) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload: SessionPayload = {
    email: input.email,
    displayName: input.displayName,
    expiresAt,
  };

  const store = await cookies();
  store.set(SESSION_COOKIE, makeToken(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  return verifyToken(token);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
