import ts from "typescript";

const NODE_GLOBALS = new Map([
  ["Buffer", "any"],
  ["process", "any"],
  ["global", "ServiceWorkerGlobalScope"],
]);

function unexpected() {
  return new Error("WRANGLER_NODE_GLOBALS_UNEXPECTED");
}

function declaredNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isBindingElement(element) ? declaredNames(element.name) : []);
}

/**
 * Local compatibility treatment for unresolved workerd issue #7026:
 * https://github.com/cloudflare/workerd/issues/7026
 * The still-unmerged https://github.com/cloudflare/workerd/pull/7539 proposes
 * const -> var. With this project's declaration order, var:any still shadows
 * typed Node constructors. Delegate only these three globals to @types/node
 * instead. This changes declarations only, never runtime bytes or crypto.
 * All other declarations, comments and line endings remain byte-for-byte.
 */
export function normalizeNodeGlobals(source) {
  if (typeof source !== "string") throw unexpected();
  const file = ts.createSourceFile("worker-configuration.d.ts", source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) throw unexpected();

  const declarations = new Map([...NODE_GLOBALS.keys()].map((name) => [name, []]));
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)
      || ts.isModuleDeclaration(node) || ts.isImportClause(node) || ts.isImportSpecifier(node)
      || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node))
      && node.name && ts.isIdentifier(node.name) && NODE_GLOBALS.has(node.name.text)) throw unexpected();
    if (ts.isVariableDeclaration(node)) {
      for (const name of declaredNames(node.name)) declarations.get(name)?.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);

  if ([...declarations.values()].every((nodes) => nodes.length === 0)) return source;
  if ([...declarations.values()].some((nodes) => nodes.length !== 1)) throw unexpected();

  const removals = [];
  for (const [name, type] of NODE_GLOBALS) {
    const declaration = declarations.get(name)[0];
    const list = declaration.parent;
    const statement = list.parent;
    if (!ts.isIdentifier(declaration.name) || !ts.isVariableDeclarationList(list)
      || list.declarations.length !== 1 || !ts.isVariableStatement(statement)
      || statement.parent !== file) throw unexpected();
    const text = statement.getText(file);
    if (text !== `declare const ${name}: ${type};` && text !== `declare var ${name}: ${type};`) throw unexpected();
    removals.push({ start: statement.getStart(file), end: statement.getEnd() });
  }

  let normalized = source;
  for (const { start, end } of removals.sort((a, b) => b.start - a.start)) {
    normalized = normalized.slice(0, start) + normalized.slice(end);
  }
  return normalized;
}
