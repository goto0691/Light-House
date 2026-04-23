export type SearchPrefixMode = "person" | "zettel" | "tag" | "action" | "help" | "general";

export function resolveSearchPrefix(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return {
      mode: "general" as const,
      query: "",
      types: undefined as string[] | undefined,
    };
  }

  if (normalized.startsWith(">")) {
    return {
      mode: "action" as const,
      query: normalized.slice(1).trim(),
      types: undefined,
    };
  }

  if (normalized.startsWith("?")) {
    return {
      mode: "help" as const,
      query: normalized.slice(1).trim(),
      types: undefined,
    };
  }

  if (normalized.startsWith("@")) {
    return {
      mode: "person" as const,
      query: normalized.slice(1).trim(),
      types: ["person"],
    };
  }

  if (normalized.startsWith("[[")) {
    return {
      mode: "zettel" as const,
      query: normalized.slice(2).trim(),
      types: ["zettel", "media", "place"],
    };
  }

  if (normalized.startsWith("#")) {
    return {
      mode: "tag" as const,
      query: normalized.slice(1).trim(),
      types: ["tag"],
    };
  }

  return {
    mode: "general" as const,
    query: normalized,
    types: undefined as string[] | undefined,
  };
}

export function resolveEditorPrefix(value: string) {
  const trailing = value.split(/\s+/).pop() ?? "";

  if (trailing.startsWith("@")) {
    return { mode: "person" as const, query: trailing.slice(1) };
  }

  if (trailing.startsWith("[[")) {
    return { mode: "zettel" as const, query: trailing.slice(2) };
  }

  if (trailing.startsWith("#")) {
    return { mode: "tag" as const, query: trailing.slice(1) };
  }

  return { mode: null, query: "" } as const;
}
