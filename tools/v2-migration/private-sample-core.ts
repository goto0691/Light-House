import path from "node:path";

import { detectLegacyDamage, type LegacyAdapterV1 } from "../../apps/web/src/lib/v2/migration/legacy-adapters-v1";

export const PRIVATE_SAMPLE_FORMAT = "lighthouse-private-legacy-sample" as const;
export const PRIVATE_SAMPLE_VERSION = 1 as const;

const HIGH_RISK_ALL_TABLES = new Map<string, string>([
  ["health_metrics", "HIGH_RISK_HEALTH"],
  ["interactions", "HIGH_RISK_PERSONAL"],
  ["network_edges", "HIGH_RISK_RELATION"],
  ["task_people_relations", "HIGH_RISK_RELATION"],
  ["media_people_relations", "HIGH_RISK_RELATION"],
  ["zettel_people_relations", "HIGH_RISK_RELATION"],
  ["daily_entry_people_relations", "HIGH_RISK_RELATION"],
  ["daily_log_people_relations", "HIGH_RISK_RELATION"],
  ["project_people_relations", "HIGH_RISK_RELATION"],
]);

const ATTACHMENT_COLUMN = /^(?:r2_key|cdn_url|bucket_key|image_url|photo_url|cover_image_url|artifact_url)$/;
const NON_EMPTY = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

export function computeBaseSampleSize(rowCount: number) {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new Error("Row count must be a non-negative safe integer.");
  if (rowCount < 5) return rowCount;
  return Math.max(5, Math.min(20, Math.ceil(rowCount * 0.05)));
}

export function computeEvenSampleIndexes(rowCount: number, sampleSize = computeBaseSampleSize(rowCount)) {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new Error("Row count must be a non-negative safe integer.");
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0 || sampleSize > rowCount) throw new Error("Sample size is outside the row range.");
  if (sampleSize === 0) return [];
  if (sampleSize === rowCount) return Array.from({ length: rowCount }, (_, index) => index);
  if (sampleSize === 1) return [0];
  return Array.from({ length: sampleSize }, (_, index) => Math.floor(index * (rowCount - 1) / (sampleSize - 1)));
}

export function isPrivateArtifactOutput(outputRoot: string, repositoryRoot = process.cwd()) {
  const allowedRoot = path.resolve(repositoryRoot, "artifacts", "v2-migration");
  const resolvedOutput = path.resolve(repositoryRoot, outputRoot);
  const relative = path.relative(allowedRoot, resolvedOutput);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function assertReadOnlySql(sql: string) {
  if (!/^\s*(?:select|pragma)\b/i.test(sql)) throw new Error("Private sampling accepts SELECT or PRAGMA only.");
  if (/\b(?:insert|update|delete|drop|alter|create|replace|vacuum|attach|detach|reindex)\b/i.test(sql)) {
    throw new Error("Private sampling rejected a mutating SQL keyword.");
  }
}

function hasAny(row: Readonly<Record<string, unknown>>, columns: readonly string[]) {
  return columns.some((column) => NON_EMPTY(row[column]));
}

export function attachmentColumns(columns: readonly string[]) {
  return columns.filter((column) => ATTACHMENT_COLUMN.test(column));
}

export function candidateReasons(adapter: LegacyAdapterV1, row: Readonly<Record<string, unknown>>, availableColumns: readonly string[]) {
  const reasons = new Set<string>(detectLegacyDamage(adapter, row));
  const highRiskAll = HIGH_RISK_ALL_TABLES.get(adapter.table);
  if (highRiskAll) reasons.add(highRiskAll);
  if (adapter.table === "people" && hasAny(row, ["birth_date", "phone", "email", "address", "social_links"])) reasons.add("HIGH_RISK_PERSONAL");
  if (adapter.table === "gifts" && NON_EMPTY(row.person_id)) reasons.add("HIGH_RISK_PERSONAL");
  if (adapter.table === "place_visits" && NON_EMPTY(row.companion_ids)) reasons.add("HIGH_RISK_RELATION");
  if (adapter.table === "entity_relations" && [row.from_type, row.to_type].some((value) => /person|people|contact/i.test(String(value ?? "")))) reasons.add("HIGH_RISK_RELATION");
  if (adapter.table === "attachments") reasons.add("ATTACHMENT_RECORD");
  else if (hasAny(row, attachmentColumns(availableColumns))) reasons.add("ATTACHMENT_REFERENCE");
  return [...reasons].sort();
}

const quoted = (column: string) => `legacy."${column.replaceAll('"', '""')}"`;
const nonEmptySql = (column: string) => `${quoted(column)} is not null and trim(cast(${quoted(column)} as text))<>''`;

export function candidateSqlPredicate(adapter: LegacyAdapterV1, availableColumns: readonly string[]) {
  const columns = new Set(availableColumns);
  const predicates: string[] = [];
  const sourceFields = adapter.sourceTextFields.filter((column) => columns.has(column));
  if (sourceFields.length) predicates.push(`not (${sourceFields.map(nonEmptySql).join(" or ")})`);
  for (const column of adapter.jsonFields.filter((name) => columns.has(name))) {
    predicates.push(`(${nonEmptySql(column)} and json_valid(${quoted(column)})=0)`);
  }
  if (HIGH_RISK_ALL_TABLES.has(adapter.table)) predicates.push("1=1");
  if (adapter.table === "people") {
    const sensitive = ["birth_date", "phone", "email", "address", "social_links"].filter((column) => columns.has(column));
    if (sensitive.length) predicates.push(`(${sensitive.map(nonEmptySql).join(" or ")})`);
  }
  if (adapter.table === "gifts" && columns.has("person_id")) predicates.push(`(${nonEmptySql("person_id")})`);
  if (adapter.table === "place_visits" && columns.has("companion_ids")) predicates.push(`(${nonEmptySql("companion_ids")})`);
  if (adapter.table === "entity_relations" && columns.has("from_type") && columns.has("to_type")) {
    const relationTypeMatch = (column: string) => {
      const lowered = `lower(cast(${quoted(column)} as text))`;
      return `(${lowered} like '%person%' or ${lowered} like '%people%' or ${lowered} like '%contact%')`;
    };
    predicates.push(`(${relationTypeMatch("from_type")} or ${relationTypeMatch("to_type")})`);
  }
  if (adapter.table === "attachments") predicates.push("1=1");
  else {
    const attachmentFields = attachmentColumns(availableColumns);
    if (attachmentFields.length) predicates.push(`(${attachmentFields.map(nonEmptySql).join(" or ")})`);
  }
  return predicates.length ? `(${predicates.join(" or ")})` : null;
}
