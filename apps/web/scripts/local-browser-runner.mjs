// Local browser helper for owner-picked Threads/Instagram posts (2026-10-19 decision, option 2).
// Started by `npm run dev:local`; listens only on 127.0.0.1 and answers only the app's own server,
// which sends the per-run secret. It drives a dedicated Chrome profile that the owner logged into
// themselves (never with credentials typed by software).
//
// Read-only by construction: these are fixed steps, not an AI agent. It opens only one post address
// of the two sites, clicks only elements whose visible text is "더 보기"/"more" (never menus or links)
// and carousel "다음"/"Next" buttons inside the post, never types or presses keys, and stops at a
// login wall or security check instead of answering it. One post at a time, at least 20 seconds apart.
import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";

import { chromium } from "playwright";

const port = Number(process.env.LIGHT_HOUSE_LOCAL_BROWSER_PORT ?? 3101);
const secret = process.env.LIGHT_HOUSE_LOCAL_BROWSER_SECRET ?? "";
const profileDir = process.env.LIGHT_HOUSE_LOCAL_BROWSER_PROFILE ?? "";
// Synthetic pages served from this PC for checks only; empty in normal use.
const testOrigin = process.env.LIGHT_HOUSE_LOCAL_BROWSER_TEST_ORIGIN ?? "";
if (secret.length < 32 || !profileDir) { console.error("[local-browser] secret or profile directory missing; not starting."); process.exit(1); }
mkdirSync(profileDir, { recursive: true });

const MIN_GAP_MS = 20_000;
const MAX_SLIDES = 6;
const LOGIN_PAGES = { threads: "https://www.threads.net/login", instagram: "https://www.instagram.com/accounts/login/" };
const SITE_HOSTS = {
  threads: new Set(["threads.net", "www.threads.net", "threads.com", "www.threads.com"]),
  instagram: new Set(["instagram.com", "www.instagram.com"]),
};
const POST_PATHS = { threads: /^\/@[A-Za-z0-9._]{1,40}\/post\/[A-Za-z0-9_-]{5,60}\/?$/, instagram: /^\/(?:[A-Za-z0-9._]{1,40}\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,60}\/?$/ };
const EXPAND_TEXT = /^\s*(?:…\s*)?(?:더 보기|더보기|more|see more|show more)\s*$/i;
const NEXT_LABEL = /^(?:다음|next)$/i;

function siteOf(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (testOrigin && url.origin === testOrigin) return "test";
  if (url.protocol !== "https:") return null;
  for (const [site, hosts] of Object.entries(SITE_HOSTS)) if (hosts.has(url.hostname) && POST_PATHS[site].test(url.pathname)) return site;
  return null;
}
/** Where the page itself may go: the same site (its post, its own login redirect) or the test origin. */
function allowedNavigation(raw, site) {
  try {
    const url = new URL(raw);
    if (site === "test") return url.origin === testOrigin;
    return url.protocol === "https:" && (SITE_HOSTS[site].has(url.hostname) || (site === "threads" && url.hostname.endsWith("instagram.com")));
  } catch { return false; }
}

let context = null;
async function browser() {
  if (context) return context;
  context = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: false, viewport: { width: 1100, height: 1300 }, args: ["--no-first-run", "--no-default-browser-check"] });
  context.on("close", () => { context = null; });
  return context;
}
const pause = (min, max) => new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));

async function postRoot(page) {
  for (const selector of ["main article", "article", "[role='main']", "main"]) {
    const candidate = page.locator(selector).first();
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return page.locator("body");
}
async function screenshotOf(root, page) {
  const box = await root.boundingBox().catch(() => null);
  if (box && box.height > 0 && box.height <= 3200) return root.screenshot({ type: "png", timeout: 10_000 });
  return page.screenshot({ type: "png", timeout: 10_000 });
}
/** Visible-text "더 보기" only: never an element that opens a menu or is a link. */
async function expandOnce(root) {
  const candidates = root.getByText(EXPAND_TEXT);
  const count = Math.min(await candidates.count().catch(() => 0), 5);
  for (let index = 0; index < count; index += 1) {
    const item = candidates.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const safe = await item.evaluate((element) => !element.closest("a[href], [aria-haspopup], [role='menu'], [role='menuitem'], form, nav, header")).catch(() => false);
    if (!safe) continue;
    await item.click({ timeout: 3000 }).catch(() => undefined);
    return true;
  }
  return false;
}

async function capture(target) {
  const site = siteOf(target);
  if (!site) return { status: 400, body: { error: "unsupported_url" } };
  const page = await (await browser()).newPage();
  try {
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !allowedNavigation(request.url(), site)) return route.abort();
      return route.continue();
    });
    const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
    await pause(2500, 4000);
    const landed = new URL(page.url());
    if (/\/(?:challenge|checkpoint)\b/i.test(landed.pathname)) return { status: 200, body: { status: "blocked" } };
    if (/\/(?:accounts\/)?login\b/i.test(landed.pathname) || await page.locator("input[type='password']").first().isVisible().catch(() => false)) return { status: 200, body: { status: "login_required" } };
    if (!response || response.status() >= 400) return { status: 200, body: { status: "unavailable" } };
    const postUrl = page.url();
    const root = await postRoot(page);
    for (let attempt = 0; attempt < 3 && await expandOnce(root); attempt += 1) await pause(800, 1500);
    if (page.url() !== postUrl) return { status: 200, body: { status: "unavailable" } };
    const screenshots = [await screenshotOf(root, page)];
    for (let slide = 1; slide < MAX_SLIDES; slide += 1) {
      const next = root.getByRole("button", { name: NEXT_LABEL }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click({ timeout: 3000 }).catch(() => undefined);
      await pause(900, 1600);
      if (page.url() !== postUrl) break;
      screenshots.push(await screenshotOf(root, page));
    }
    return { status: 200, body: { status: "captured", title: (await page.title().catch(() => "")).slice(0, 200), screenshots: screenshots.map((bytes) => bytes.toString("base64")) } };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function openLogin(site) {
  const page = await (await browser()).newPage();
  await page.goto(LOGIN_PAGES[site], { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  await page.bringToFront().catch(() => undefined);
}

let busy = false, lastCaptureAt = 0;
const authorized = (header) => {
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const send = (response, status, body) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); };

createServer((request, response) => {
  if (request.method !== "POST" || !authorized(request.headers.authorization)) return send(response, 404, { error: "not_found" });
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; if (raw.length > 4096) request.destroy(); });
  request.on("end", async () => {
    let body, owned = false;
    try { body = JSON.parse(raw || "{}"); } catch { return send(response, 400, { error: "invalid_json" }); }
    try {
      if (request.url === "/login-window") {
        if (!LOGIN_PAGES[body.site]) return send(response, 400, { error: "unsupported_site" });
        await openLogin(body.site);
        return send(response, 200, { opened: true });
      }
      if (request.url !== "/capture") return send(response, 404, { error: "not_found" });
      if (busy) return send(response, 429, { error: "busy" });
      busy = true; owned = true;
      const wait = lastCaptureAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await pause(wait, wait + 500);
      const result = await capture(String(body.url ?? ""));
      lastCaptureAt = Date.now();
      return send(response, result.status, result.body);
    } catch {
      return send(response, 500, { error: "capture_failed" });
    } finally {
      if (owned) busy = false;
    }
  });
}).listen(port, "127.0.0.1", () => console.log(`[local-browser] ready on 127.0.0.1:${port}; Chrome opens on first use`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await context?.close().catch(() => undefined); process.exit(0); });
