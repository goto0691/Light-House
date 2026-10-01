type JsonSchema = Readonly<Record<string, unknown>>;

export type JsonSchemaValidationResult = Readonly<{
  valid: boolean;
  errors: readonly string[];
}>;

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value: unknown, expected: string) {
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "null") return value === null;
  return typeof value === expected;
}

function validateNode(schema: JsonSchema, value: unknown, path: string, errors: string[]) {
  const expectedTypes = typeof schema.type === "string"
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type.filter((item): item is string => typeof item === "string")
      : [];
  if (expectedTypes.length && !expectedTypes.some((type) => matchesType(value, type))) {
    errors.push(`${path} must be ${expectedTypes.join(" or ")}; received ${valueType(value)}.`);
    return;
  }

  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    errors.push(`${path} must equal the schema constant.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of the allowed values.`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}.`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}.`);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}.`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}.`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path} has fewer than ${schema.minItems} items.`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path} has more than ${schema.maxItems} items.`);
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      value.forEach((item, index) => validateNode(schema.items as JsonSchema, item, `${path}[${index}]`, errors));
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, unknown>
      : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    for (const key of required) {
      if (!Object.hasOwn(object, key)) errors.push(`${path}.${key} is required.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key} is not allowed.`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(object, key) && childSchema && typeof childSchema === "object" && !Array.isArray(childSchema)) {
        validateNode(childSchema as JsonSchema, object[key], `${path}.${key}`, errors);
      }
    }
  }
}

export function validateJsonSchemaValue(schema: JsonSchema, value: unknown): JsonSchemaValidationResult {
  const errors: string[] = [];
  validateNode(schema, value, "$", errors);
  return { valid: errors.length === 0, errors };
}
