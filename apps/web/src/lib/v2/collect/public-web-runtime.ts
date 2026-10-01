import "server-only";

import dns from "node:dns/promises";

import { collectPublicWeb, type PublicWebResult } from "@/lib/v2/collect/public-web-fetch";

/** Exact operator-managed hosts only. An absent or malformed setting allows no outbound URL. */
export function publicWebAllowedHosts(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  const hosts = value.split(",").map((item) => item.trim().toLowerCase());
  if (hosts.some((host) => !host.includes(".") || host.length > 253
    || host.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))) return [];
  return [...new Set(hosts)];
}

async function resolvePublicHost(hostname: string, _signal: AbortSignal): Promise<readonly string[]> {
  const settled = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses: string[] = [];
  for (const answer of settled) {
    if (answer.status === "fulfilled") addresses.push(...answer.value);
    else {
      const code = (answer.reason as { code?: string })?.code;
      if (code !== "ENODATA" && code !== "ENOTFOUND") throw answer.reason;
    }
  }
  return addresses;
}

/** DNS is a fail-closed preflight. Worker fetch may re-resolve after this check;
 * do not use this adapter for arbitrary attacker-selected hosts or claim IP pinning. */
export function collectConfiguredPublicWeb(url: string): Promise<PublicWebResult> {
  return collectPublicWeb({ url, allowedHosts: publicWebAllowedHosts(process.env.V2_PUBLIC_WEB_ALLOWED_HOSTS) }, {
    resolve: resolvePublicHost,
    transport: (request) => fetch(request.url, {
      method: request.method, redirect: request.redirect, credentials: request.credentials,
      referrerPolicy: "no-referrer", cache: "no-store", signal: request.signal,
      headers: { Accept: "text/plain, text/html;q=0.9" },
    }),
  });
}
