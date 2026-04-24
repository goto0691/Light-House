import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ results?: T[]; success?: boolean }>;
  success?: boolean;
};

type ReviewCountRow = { openAiReviews: number | null };

const maxRuntimeMinutes = Number(process.argv.find((arg) => arg.startsWith("--max-runtime-minutes="))?.split("=")[1] ?? 60);
const maxRequests = Number(process.argv.find((arg) => arg.startsWith("--max-requests="))?.split("=")[1] ?? 500);
const delayMs = Number(process.argv.find((arg) => arg.startsWith("--delay-ms="))?.split("=")[1] ?? 4200);
const batchSize = Number(process.argv.find((arg) => arg.startsWith("--batch-size="))?.split("=")[1] ?? 25);
const applyMinConfidence = Number(process.argv.find((arg) => arg.startsWith("--apply-min-confidence="))?.split("=")[1] ?? 0.9);

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.trim().match(/^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/);
      if (!match) continue;
      process.env[match[1]] ??= match[2].replace(/^"|"$/g, "");
    }
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function d1Endpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${requiredEnv("CLOUDFLARE_D1_DATABASE_ID")}/query`;
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const response = await fetch(d1Endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? requiredEnv("DATABASE_AUTH_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const payload = (await response.json()) as D1Envelope<T>;
  const result = payload.result?.[0];
  if (!response.ok || payload.success === false || result?.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "D1 query failed.");
  }
  return result?.results ?? [];
}

function run(command: string, args: string[]) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { shell: true, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function countOpenAiReviews() {
  const rows = await queryD1<ReviewCountRow>(
    `select count(*) as openAiReviews
     from migration_review_items
     where issue_type like 'ai:%'
       and status = 'open'
       and deleted_at is null`,
  );
  return Number(rows[0]?.openAiReviews ?? 0);
}

async function main() {
  loadEnv();
  requiredEnv("GEMINI_API_KEY");

  if (!existsSync("logs")) mkdirSync("logs");
  const logPath = join("logs", "ai-curation-queue.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalError = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
    log.write(chunk);
    return originalWrite(chunk, encoding as BufferEncoding, callback);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
    log.write(chunk);
    return originalError(chunk, encoding as BufferEncoding, callback);
  }) as typeof process.stderr.write;

  const startedAt = Date.now();
  const deadline = startedAt + maxRuntimeMinutes * 60 * 1000;
  let requestsUsed = 0;
  let batches = 0;
  let stopReason = "completed";

  console.log(
    JSON.stringify({
      event: "ai-curation-queue-started",
      maxRuntimeMinutes,
      maxRequests,
      delayMs,
      batchSize,
      applyMinConfidence,
      logPath,
      startedAt: new Date(startedAt).toISOString(),
    }),
  );

  while (Date.now() < deadline && requestsUsed < maxRequests) {
    const remainingRequests = Math.min(batchSize, maxRequests - requestsUsed);
    const remainingMs = Math.max(1, deadline - Date.now());
    const remainingMinutes = Math.max(1, Math.floor(remainingMs / 60000));
    batches += 1;

    console.log(JSON.stringify({ event: "curation-batch-start", batches, remainingRequests, remainingMinutes }));
    const code = await run("npm", [
      "run",
      "db:ai-curate",
      "--",
      "--apply",
      `--limit=${remainingRequests}`,
      `--delay-ms=${delayMs}`,
      `--max-requests=${remainingRequests}`,
      `--max-runtime-minutes=${remainingMinutes}`,
    ]);

    requestsUsed += remainingRequests;
    if (code !== 0) {
      stopReason = "curation_child_failed";
      break;
    }

    const openBeforeApply = await countOpenAiReviews();
    console.log(JSON.stringify({ event: "apply-safe-curations-start", openBeforeApply }));
    const applyCode = await run("npm", ["run", "db:apply-ai-curation", "--", "--apply", "--limit=500", `--min-confidence=${applyMinConfidence}`]);
    if (applyCode !== 0) {
      stopReason = "apply_child_failed";
      break;
    }

    if (Date.now() + delayMs >= deadline) {
      stopReason = "max_runtime";
      break;
    }
    await sleep(delayMs);
  }

  if (requestsUsed >= maxRequests) stopReason = "max_requests";
  if (Date.now() >= deadline) stopReason = "max_runtime";

  console.log(
    JSON.stringify({
      event: "ai-curation-queue-stopped",
      stopReason,
      requestsUsed,
      batches,
      runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      finishedAt: new Date().toISOString(),
    }),
  );
  log.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
