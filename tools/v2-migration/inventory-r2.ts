import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "web"), process.env.NODE_ENV !== "production");

const valueAfter = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const runId = valueAfter("--run-id") ?? new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = path.resolve(valueAfter("--out") ?? path.join("artifacts", "v2-migration", runId));
const endpoint = process.env.R2_S3_ENDPOINT ?? (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new Error("R2_ACCOUNT_ID (or R2_S3_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required.");
async function main() {
const client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
const rows: Record<string, unknown>[] = [];
let continuationToken: string | undefined;
do {
  const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
  for (const object of page.Contents ?? []) rows.push({ key: object.Key, bytes: object.Size ?? 0, etag: object.ETag?.replace(/^"|"$/g, "") ?? null, lastModified: object.LastModified?.toISOString() ?? null, etagIsSha256: false });
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);
const directory = path.join(outputRoot, "inventory");
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, "r2-objects.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
process.stdout.write(`${JSON.stringify({ runId, outputRoot, bucket, objects: rows.length, bytes: rows.reduce((sum, row) => sum + Number(row.bytes), 0), etagIsSha256: false }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "R2 inventory failed."}\n`); process.exitCode = 1; });
