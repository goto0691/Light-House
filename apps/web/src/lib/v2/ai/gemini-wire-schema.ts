import { V2ModelError } from "@/lib/v2/ai/gateway";

type JsonSchema = Readonly<Record<string, unknown>>;

function enumType(values: readonly unknown[]) {
  if (values.length && values.every((value) => typeof value === "string")) return "string";
  if (values.length && values.every((value) => typeof value === "number" && Number.isFinite(value))) return "number";
  throw new V2ModelError("invalid_schema", "Gemini response enums require string or numeric values.", false);
}

/** Provider-only projection; never use it instead of the application's validator.
 * GenerationConfig supports a JSON Schema subset. Keep string bounds and array
 * upper bounds locally, spell constants as typed enums, and express non-null
 * unions using anyOf. The analysis envelope's nested `maxItems` (up to 300) made
 * the live API reject the request as INVALID_ARGUMENT; the canonical validator
 * still enforces those limits on the returned value.
 * Visit schema positions only: a property named `const` is still user data.
 */
export function toGeminiResponseJsonSchema(schema: JsonSchema): Record<string, unknown> {
  const output = Object.fromEntries(Object.entries(schema)
    .filter(([key]) => !["const", "minLength", "maxLength", "maxItems"].includes(key))
    .map(([key, value]) => {
      if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
        return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toGeminiResponseJsonSchema(child as JsonSchema)]))];
      }
      if ((key === "items" || key === "additionalProperties") && value && typeof value === "object" && !Array.isArray(value)) {
        return [key, toGeminiResponseJsonSchema(value as JsonSchema)];
      }
      if (key === "anyOf" && Array.isArray(value)) return [key, value.map((child) => toGeminiResponseJsonSchema(child as JsonSchema))];
      return [key, structuredClone(value)];
    }));

  if (Object.hasOwn(schema, "const")) {
    output.enum = [schema.const];
    output.type ??= enumType([schema.const]);
  } else if (Array.isArray(output.enum) && !output.type) {
    output.type = enumType(output.enum);
  }
  if (Array.isArray(output.type)) {
    const nonNull = output.type.filter((type) => type !== "null");
    if (nonNull.length > 1) {
      const nullable = output.type.includes("null");
      output.anyOf = nonNull.map((type) => ({ type: nullable ? [type, "null"] : type }));
      delete output.type;
    }
  }
  return output;
}
