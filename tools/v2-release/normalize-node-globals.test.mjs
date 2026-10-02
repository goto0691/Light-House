import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { normalizeNodeGlobals } from "./normalize-node-globals.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const names = ["Buffer", "process", "global"];
const declarations = [
  "declare const Buffer: any;",
  "declare const process: any;",
  "declare const global: ServiceWorkerGlobalScope;",
];
const surrounding = [
  "// 한글 comments and literal const Buffer must remain unchanged.",
  "interface ServiceWorkerGlobalScope { Buffer: any; process: any; global: ServiceWorkerGlobalScope; }",
  "declare const crypto: Crypto;",
  "declare const self: ServiceWorkerGlobalScope;",
  "declare const Request: typeof Request;",
];
const simple = [...surrounding, ...declarations, "// preserved trailing comment"].join("\n") + "\n";

test("delegates exactly the three Node declarations and preserves every other byte", () => {
  for (const eol of ["\n", "\r\n"]) {
    const input = simple.replaceAll("\n", eol);
    const expected = declarations.reduce((text, declaration) => text.replace(declaration, ""), input);
    assert.equal(normalizeNodeGlobals(input), expected);
    assert.equal(normalizeNodeGlobals(expected), expected);
    const varInput = declarations.reduce((text, declaration) => text.replace(declaration, declaration.replace("const", "var")), input);
    assert.equal(normalizeNodeGlobals(varInput), expected);
  }
});

test("preserves declaration-adjacent comments, BOM and unrelated Node-looking identifiers", () => {
  const input = `\uFEFF// preamble\r\n${declarations.map((line) => `  ${line} // adjacent\r\n`).join("")}declare const BufferSource: any;\r\n`;
  const expected = declarations.reduce((text, declaration) => text.replace(declaration, ""), input);
  assert.equal(normalizeNodeGlobals(input), expected);
});

test("refuses partial, duplicate, malformed, nested or destructured target declarations", () => {
  const bad = [
    ...declarations.map((line) => simple.replace(line, "")),
    ...declarations.map((line) => simple + line),
    simple.replace("declare const Buffer: any;", "declare let Buffer: any;"),
    simple.replace("declare const Buffer: any;", "declare const Buffer: unknown;"),
    simple.replace("declare const Buffer: any;", "declare const Buffer: any"),
    simple.replace("declare const Buffer: any;", "declare const Buffer:any;"),
    simple.replace("declare const Buffer: any;", "declare const Buffer: any, duplicate: any;"),
    simple.replace("declare const Buffer: any;", "declare namespace nested { const Buffer: any; }"),
    simple.replace("declare const Buffer: any;", "declare const { Buffer }: { Buffer: any };"),
    simple.replace("declare const Buffer: any;", "export declare const Buffer: any;"),
    names.map((name) => `declare function ${name}(): void;`).join("\n"),
    names.map((name) => `declare class ${name} {}`).join("\n"),
    simple + 'import { Buffer } from "node:buffer";',
    simple + "declare const unfinished:",
  ];
  for (const input of bad) {
    assert.throws(() => normalizeNodeGlobals(input), { message: "WRANGLER_NODE_GLOBALS_UNEXPECTED" });
  }
  assert.throws(() => normalizeNodeGlobals(null), { message: "WRANGLER_NODE_GLOBALS_UNEXPECTED" });
});

function originalRuntime() {
  // The wrapper may already have normalized the checked-in file. Reinsert only
  // this known upstream defect in memory; no generated file is modified.
  const current = readFileSync(path.join(root, "apps/web/worker-configuration.d.ts"), "utf8");
  return normalizeNodeGlobals(current) + "\n" + declarations.join("\n") + "\n";
}

const fixture = `import { Buffer as ModuleBuffer } from "node:buffer";
import { randomBytes } from "node:crypto";
const random = randomBytes(16);
random.toString("hex");
const derived = randomBytes(64) as Buffer;
derived.toString("hex");
randomBytes(32).toString("base64url");
const proofBytes = {} as Buffer;
proofBytes.toString("utf8");
const moduleConstructor = ModuleBuffer;
const wrapped = ModuleBuffer.from(random);
const nodeProcess = process;
const nodeGlobal = global;
const workerCrypto = crypto;
const workerSelf = self;
const workerRequest = Request;
const workerCaches = caches;
`;

function compile(runtime, input = fixture) {
  const fixturePath = path.join(root, "tools/v2-release/__virtual_buffer_fixture.ts");
  const runtimePath = path.join(root, "tools/v2-release/__virtual_worker_runtime.d.ts");
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    // Match the existing web compiler setting; it is not changed by this fix.
    skipLibCheck: true,
    types: ["node"],
    noEmit: true,
    incremental: false,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, ...args) => {
    const fullPath = path.resolve(file);
    if (fullPath === fixturePath) return ts.createSourceFile(file, input, languageVersion, true);
    if (fullPath === runtimePath) return ts.createSourceFile(file, runtime, languageVersion, true);
    return getSourceFile(file, languageVersion, ...args);
  };
  const program = ts.createProgram([fixturePath, runtimePath], options, host);
  const source = program.getSourceFile(fixturePath);
  const checker = program.getTypeChecker();
  const variables = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      variables.set(declaration.name.getText(source), { node: declaration, type: checker.getTypeAtLocation(declaration.name) });
    }
  }
  return { checker, variables, diagnostics: [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)] };
}

test("reproduces four Buffer encoding errors then restores typed Node globals without changing Worker globals", () => {
  const raw = originalRuntime();
  const before = compile(raw);
  assert.deepEqual(before.diagnostics.map(({ code }) => code), [2554, 2554, 2554, 2554]);
  assert.ok(before.variables.get("moduleConstructor").type.flags & ts.TypeFlags.Any);
  assert.ok(before.variables.get("wrapped").type.flags & ts.TypeFlags.Any);
  assert.ok(before.variables.get("nodeProcess").type.flags & ts.TypeFlags.Any);

  const after = compile(normalizeNodeGlobals(raw));
  assert.deepEqual(after.diagnostics, []);
  for (const name of ["random", "derived", "proofBytes", "moduleConstructor", "wrapped", "nodeProcess", "nodeGlobal"]) {
    const { type } = after.variables.get(name);
    assert.equal(type.flags & ts.TypeFlags.Any, 0, `${name} must not become any`);
  }
  assert.equal(after.checker.typeToString(after.variables.get("moduleConstructor").type), "BufferConstructor");
  assert.equal(after.checker.typeToString(after.variables.get("wrapped").type), "Buffer<ArrayBuffer>");
  assert.equal(after.checker.typeToString(after.variables.get("nodeProcess").type), "Process");
  for (const name of ["workerCrypto", "workerSelf", "workerRequest", "workerCaches"]) {
    assert.equal(after.variables.get(name).type.flags & ts.TypeFlags.Any, 0, `${name} remains typed`);
    assert.equal(after.checker.typeToString(after.variables.get(name).type), before.checker.typeToString(before.variables.get(name).type));
  }
});

test("rejects invalid Buffer and Process inputs rather than silencing errors with any", () => {
  const normalized = normalizeNodeGlobals(originalRuntime());
  const invalid = compile(normalized, fixture + '\nModuleBuffer.from(42);\nprocess.exitCode = { invalid: true };\n');
  assert.deepEqual(invalid.diagnostics.map(({ code }) => code), [2769, 2322]);
});

test("const-to-var alone still leaves this project's Node constructor and Process as any", () => {
  const varOnly = originalRuntime().replace(/^declare const (Buffer|process|global):/gm, "declare var $1:");
  const result = compile(varOnly);
  assert.deepEqual(result.diagnostics, []);
  for (const name of ["moduleConstructor", "wrapped", "nodeProcess"]) {
    assert.ok(result.variables.get(name).type.flags & ts.TypeFlags.Any, `${name} reproduces the unresolved var:any limitation`);
  }
  assert.deepEqual(compile(normalizeNodeGlobals(varOnly)).diagnostics, []);
});

test("triple-absent input is idempotent while every Worker-owned declaration remains", () => {
  const normalized = normalizeNodeGlobals(originalRuntime());
  assert.equal(normalizeNodeGlobals(normalized), normalized);
  for (const name of names) assert.equal(normalized.includes(`declare const ${name}:`), false);
  for (const declaration of ["declare const crypto: Crypto;", "declare const caches: CacheStorage;", "declare const Cloudflare: Cloudflare;"]) {
    assert.ok(normalized.includes(declaration));
  }
});
