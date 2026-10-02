import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Some Windows Node releases silently omit files when recursively copying a
// non-ASCII path. OpenNext depends on this API for configs and deployable files.
// Verify the actual runtime before masking credentials or touching build output.
export function assertWorkerFilesystemSupport() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "light-house-worker-fs-")));
  const source = path.join(root, "source"), target = path.join(root, "복사");
  const filename = "synthetic.txt", sentinel = "worker-filesystem-preflight";
  try {
    mkdirSync(source);
    writeFileSync(path.join(source, filename), sentinel, { flag: "wx" });
    cpSync(source, target, { recursive: true });
    if (!existsSync(path.join(target, filename)) || readFileSync(path.join(target, filename), "utf8") !== sentinel) {
      throw new Error("WORKER_FILESYSTEM_UNSUPPORTED: this Node runtime cannot copy non-ASCII paths. Use a runtime that passes the Worker filesystem preflight.");
    }
    if (path.dirname(path.resolve(target)) !== root || realpathSync(target) !== target || lstatSync(target).isSymbolicLink()) {
      throw new Error("WORKER_FILESYSTEM_PROBE_PATH_INVALID");
    }
    rmSync(target, { recursive: true, force: true });
    if (existsSync(target)) throw new Error("WORKER_FILESYSTEM_UNSUPPORTED: this Node runtime cannot clean non-ASCII build paths.");
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
