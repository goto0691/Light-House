type JsonSchema = Readonly<Record<string, unknown>>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((branch) => record(branch) && branch.type === "null") ? schema : { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
  }
  const output = { ...schema };
  if (typeof output.type === "string") output.type = output.type === "null" ? "null" : [output.type, "null"];
  else if (Array.isArray(output.type) && !output.type.includes("null")) output.type = [...output.type, "null"];
  if (Array.isArray(output.enum) && !output.enum.includes(null)) output.enum = [...output.enum, null];
  return output;
}

/** Provider-only projection for OpenAI structured outputs in strict mode.
 * Strict mode requires every object property to be listed as required, so an
 * optional property is sent as required-but-nullable and the null is removed
 * again by `dropNullOptionals` before the canonical validator runs. Bounds the
 * provider may not support (string length, array maximum) stay local; constants
 * become typed single-value enums. Schema positions only: property names are data.
 */
export function toOpenAIStrictJsonSchema(schema: JsonSchema): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["const", "minLength", "maxLength", "maxItems", "description"].includes(key)) continue;
    if (key === "properties" && record(value)) {
      const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
      output.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => {
        const projected = toOpenAIStrictJsonSchema(child as JsonSchema);
        return [name, required.has(name) ? projected : nullable(projected)];
      }));
      output.required = Object.keys(value);
      continue;
    }
    if (key === "required") continue;
    if (key === "items" && record(value)) { output.items = toOpenAIStrictJsonSchema(value); continue; }
    if (key === "anyOf" && Array.isArray(value)) { output.anyOf = value.map((child) => toOpenAIStrictJsonSchema(child as JsonSchema)); continue; }
    output[key] = structuredClone(value);
  }
  if (Object.hasOwn(schema, "const")) {
    output.enum = [schema.const];
    if (!output.type) output.type = typeof schema.const === "number" ? "number" : typeof schema.const === "boolean" ? "boolean" : "string";
  } else if (Array.isArray(output.enum) && !output.type) {
    output.type = output.enum.every((item) => typeof item === "number") ? "number" : "string";
  }
  if (output.type === "object" || record(output.properties)) {
    output.additionalProperties = false;
    if (!record(output.properties)) { output.properties = {}; output.required = []; }
  }
  return output;
}

function acceptsNull(schema: unknown): boolean {
  if (!record(schema)) return true;
  if (schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null"))) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some(acceptsNull);
  return !schema.type && !schema.enum && !schema.anyOf && !schema.const;
}

/** Removes the nulls strict mode put in place of omitted optional properties. */
export function dropNullOptionals(value: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(value)) return record(schema.items) ? value.map((item) => dropNullOptionals(item, schema.items as JsonSchema)) : value;
  if (!record(value)) return value;
  const properties = record(schema.properties) ? schema.properties : null;
  if (!properties) {
    if (Array.isArray(schema.anyOf)) {
      const objectBranch = schema.anyOf.find((branch) => record(branch) && record(branch.properties));
      return objectBranch ? dropNullOptionals(value, objectBranch as JsonSchema) : value;
    }
    return value;
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
  const output: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    const child = properties[name];
    if (item === null && !required.has(name) && !acceptsNull(child)) continue;
    output[name] = record(child) ? dropNullOptionals(item, child) : item;
  }
  return output;
}
