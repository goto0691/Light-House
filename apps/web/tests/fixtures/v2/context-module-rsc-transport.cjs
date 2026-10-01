/* Isolated installed Flight encoder test. No server, network, build output, or browser. */
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const aliases = new Map([
  ["react", "next/dist/compiled/react/react.react-server"],
  ["react-dom", "next/dist/compiled/react-dom/react-dom.react-server"],
  ["next/dist/compiled/react", "next/dist/compiled/react/react.react-server"],
  ["next/dist/compiled/react-dom", "next/dist/compiled/react-dom/react-dom.react-server"],
]);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  return originalLoad.call(this, aliases.get(request) ?? request, parent, isMain);
};

function loadActualProjection() {
  const filename = path.resolve(__dirname, "../../../src/lib/v2/presentation/extension-registry.ts");
  const result = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(result.outputText, filename);
  return compiled.exports;
}

async function main() {
  const packet = JSON.parse(readFileSync(0, "utf8"));
  const registry = loadActualProjection();
  let projection;
  if (packet.operation === "project") {
    projection = registry.projectFirstContextModule({
      preset: registry.resolveRecordPreset("running_log"), fields: packet.fields, privacyLevel: packet.privacyLevel,
    });
  } else {
    const result = registry.resolvePresentedContextModule(packet.input);
    projection = result.kind === "ready" ? result.module : result;
  }
  if (!projection) throw new Error("Fixture projection unexpectedly omitted.");

  // Recreate the prior incompatible representation after the actual normalizer
  // ran in this same child, rather than losing prototypes through stdin JSON.
  if (packet.control === "null-value") {
    projection = { ...projection, fields: projection.fields.map((field, index) => index ? field : {
      ...field, value: Object.assign(Object.create(null), { oldValueSentinel: "null-prototype" }),
    }) };
  }
  if (packet.control === "null-locator") {
    projection = { ...projection, fields: projection.fields.map((field, index) => index ? field : {
      ...field, evidence: field.evidence.map((evidence, evidenceIndex) => evidenceIndex ? evidence : {
        ...evidence, locator: Object.assign(Object.create(null), { oldLocatorSentinel: "null-prototype" }),
      }),
    }) };
  }
  if (packet.control === "own-proto") {
    projection = { ...projection, fields: projection.fields.map((field, index) => index ? field : {
      ...field, value: JSON.parse('{"__proto__":{"kept":1},"original":"not transport safe"}'),
    }) };
  }

  const React = require("react");
  const { registerClientReference, renderToReadableStream } = require("next/dist/compiled/react-server-dom-webpack/server.edge");
  const clientId = "audit:context-module-consumer";
  const ClientConsumer = registerClientReference(function ClientConsumer() {
    throw new Error("The encoder must not execute a client component.");
  }, clientId, "default");
  const errors = [];
  const props = packet.control
    ? { projection, genericBody: "GENERIC_DOCUMENT_SENTINEL" }
    : { presentationJson: JSON.stringify(projection), genericBody: "GENERIC_DOCUMENT_SENTINEL" };
  const model = React.createElement(ClientConsumer, props);
  const stream = renderToReadableStream(model, {
    [clientId]: { id: "audit:client-module", chunks: [], name: "default", async: false },
  }, {
    onError(error) {
      errors.push({ name: error?.name ?? "Error", message: String(error?.message ?? error) });
      return "context-module-transport-error";
    },
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let wire = "", chunks = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks += 1;
    wire += decoder.decode(next.value, { stream: true });
  }
  wire += decoder.decode();
  let decoded = null, presentationJson = null;
  if (!errors.length) {
    // The server has finished. Load the matching client libraries only in this
    // isolated child; no application-wide module/cache or bundler hooks change.
    aliases.set("react", "next/dist/compiled/react/index.js");
    aliases.set("react-dom", "next/dist/compiled/react-dom/index.js");
    aliases.set("next/dist/compiled/react", "next/dist/compiled/react/index.js");
    aliases.set("next/dist/compiled/react-dom", "next/dist/compiled/react-dom/index.js");
    const { createFromReadableStream } = require("next/dist/compiled/react-server-dom-webpack/client.edge");
    const encoded = new TextEncoder().encode(wire);
    const replay = new ReadableStream({ start(controller) { controller.enqueue(encoded); controller.close(); } });
    const element = await createFromReadableStream(replay, {
      serverConsumerManifest: { moduleMap: null, serverModuleMap: null, moduleLoading: null }, replayConsoleLogs: false,
    });
    presentationJson = element.props.presentationJson ?? null;
    // This is the same JSON.parse boundary the RecordKnowledge client uses.
    decoded = presentationJson === null ? element.props.projection : JSON.parse(presentationJson);
  }
  process.stdout.write(JSON.stringify({ completed: true, chunks, reactVersion: React.version, errors, wire, decoded, presentationJson }));
}

main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error));
  process.exitCode = 1;
}).finally(() => { Module._load = originalLoad; });
