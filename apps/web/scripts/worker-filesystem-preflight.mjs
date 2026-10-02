import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const probeFile = fileURLToPath(import.meta.url);
const unsupported = () => new Error("WORKER_FILESYSTEM_UNSUPPORTED");

function probeEnvironment() {
  const env = Object.create(null);
  // Read only named system/path variables: enumerating process.env can access
  // provider credentials before the safe build has masked them.
  for (const name of ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "SystemDrive", "WINDIR"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

// Some Windows Node releases silently omit files when recursively copying a
// non-ASCII path. OpenNext depends on this API for configs and deployable files.
// Verify the actual runtime before masking credentials or touching build output.
export function assertWorkerFilesystemSupport() {
  let result;
  try {
    result = spawnSync(process.execPath, [probeFile, "--probe"], {
      env: probeEnvironment(),
      shell: false,
      windowsHide: true,
      timeout: 15_000,
      stdio: "ignore",
    });
  } catch {
    throw unsupported();
  }
  // A filesystem implementation may terminate the native process without
  // throwing a JavaScript error. Keep that failure outside the build owner.
  if (result.error || result.signal || result.status !== 0) throw unsupported();
}

function runProbe() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "light-house-worker-fs-")));
  const source = path.join(root, "source"), target = path.join(root, "복사");
  const filename = "synthetic.txt", sentinel = "worker-filesystem-preflight";
  try {
    mkdirSync(source);
    writeFileSync(path.join(source, filename), sentinel, { flag: "wx" });
    cpSync(source, target, { recursive: true });
    if (!existsSync(path.join(target, filename)) || readFileSync(path.join(target, filename), "utf8") !== sentinel) {
      throw unsupported();
    }
    if (path.dirname(path.resolve(target)) !== root || realpathSync(target) !== target || lstatSync(target).isSymbolicLink()) {
      throw new Error("WORKER_FILESYSTEM_PROBE_PATH_INVALID");
    }
    rmSync(target, { recursive: true, force: true });
    if (existsSync(target)) throw unsupported();
  } finally {
    // Only these exact synthetic paths were created. Direct removal also works
    // on runtimes whose recursive operation failed; never follow arbitrary links.
    for (const directory of [target, source]) {
      const file = path.join(directory, filename);
      if (existsSync(file)) unlinkSync(file);
      if (existsSync(directory)) rmdirSync(directory);
    }
    rmdirSync(root);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === probeFile) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--probe") throw unsupported();
    runProbe();
  } catch {
    // No child exception, payload, or temporary path crosses this boundary.
    process.exitCode = 1;
  }
}
