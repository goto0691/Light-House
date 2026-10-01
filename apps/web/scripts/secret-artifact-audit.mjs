import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const NEXT_ENV_FILE_NAMES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
];

export function nextEnvFilePaths(monorepoRoot, appDir) {
  return [...new Set([monorepoRoot, appDir].flatMap((directory) =>
    NEXT_ENV_FILE_NAMES.map((name) => path.join(directory, name)),
  ))];
}

export function isSecretKey(name) {
  return /(?:^|_)(?:SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH|CREDENTIAL|DATABASE_URL)(?:$|_)/i.test(name);
}

export function loadEnvAuditCorpus(envFiles) {
  const keys = new Set();
  const entries = [];
  const seen = new Set();
  for (const file of envFiles) {
    let parsed;
    try {
      parsed = parseEnv(readFileSync(file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`Unable to parse environment file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const [key, value] of Object.entries(parsed)) {
      keys.add(key);
      const secretKey = isSecretKey(key);
      if (secretKey && key.startsWith("NEXT_PUBLIC_") && value) {
        throw new Error(`Refusing a public environment variable with a secret-bearing name: ${key} in ${file}`);
      }
      if (secretKey && value && value.length < 6) {
        throw new Error(`Refusing a secret value shorter than 6 characters: ${key} in ${file}`);
      }
      if (!secretKey || !value) continue;
      const variants = [value, JSON.stringify(value).slice(1, -1)];
      for (const variant of variants) {
        const fingerprint = `${key}\0${variant}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        entries.push({ key, bytes: Buffer.from(variant) });
      }
    }
  }
  return { keys, entries };
}

function filesUnder(target, workspaceRoot) {
  const resolved = path.resolve(target);
  const root = path.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Artifact target is outside the workspace: ${resolved}`);
  }
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing to scan a symbolic-link artifact: ${resolved}`);
  if (stat.isFile()) return [resolved];
  if (!stat.isDirectory()) return [];
  return readdirSync(resolved, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => filesUnder(path.join(resolved, entry.name), root));
}

export function scanArtifactsForEnvSecrets({ targets, workspaceRoot, corpus }) {
  const files = [...new Set(targets.flatMap((target) => filesUnder(target, workspaceRoot)))];
  const hits = [];
  const hitKeys = new Set();
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const entry of corpus.entries) {
      if (bytes.indexOf(entry.bytes) === -1) continue;
      const fingerprint = `${entry.key}\0${file}`;
      if (hitKeys.has(fingerprint)) continue;
      hitKeys.add(fingerprint);
      hits.push({ key: entry.key, file });
    }
  }
  return { files, hits };
}
