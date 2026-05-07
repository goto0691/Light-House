import type { PropertyDefinition } from "./types";

export type SourcePropertyLike = {
  name: string;
  type?: string | null;
  value?: string | null;
};

export type SourcePropertyClassification = {
  status: "suggested" | "unmapped" | "hidden";
  displayName: string;
  targetValue: string;
  confidence: number;
  reason: string;
};

type HiddenSourcePropertyRule = {
  aliases: string[];
  label: string;
  reason: string;
};

const COMMON_HIDDEN_SOURCE_PROPERTY_RULES: HiddenSourcePropertyRule[] = [
  {
    aliases: ["id", "notion id", "page id", "object", "parent", "workspace", "workspace id"],
    label: "원본 시스템 ID",
    reason: "원본 시스템 식별자는 Source Record에 이미 보존됩니다.",
  },
  {
    aliases: ["created by", "created_by", "last edited by", "last_edited_by", "edited by", "owner"],
    label: "원본 편집자",
    reason: "편집자 메타데이터는 일반 속성보다 감사 정보에 가깝습니다.",
  },
  {
    aliases: ["last edited time", "last_edited_time", "updated at", "updated_at", "modified", "modified time"],
    label: "원본 수정 시각",
    reason: "수정 시각은 canonical 속성으로 바로 쓰기보다 출처 감사 정보로 보존합니다.",
  },
  {
    aliases: ["archived", "in trash", "in_trash", "deleted", "deleted at", "deleted_at"],
    label: "원본 보관 상태",
    reason: "삭제/보관 플래그는 import 상태 판단용 메타데이터입니다.",
  },
  {
    aliases: ["public url", "public_url", "notion url", "notion_url", "api url", "api_url"],
    label: "원본 시스템 URL",
    reason: "원본 링크는 Source Record의 원본 열기 동작에서 관리합니다.",
  },
  {
    aliases: ["created time", "created_time"],
    label: "원본 생성 시각",
    reason: "도메인 registry에 생성일 속성이 없으면 감사 정보로만 보존합니다.",
  },
];

type SourcePropertyMatch = {
  definition: PropertyDefinition;
  score: number;
};

export function normalizeSourcePropertyName(value: string) {
  return value
    .toLowerCase()
    .replace(/[_#/]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySourceProperty(
  property: SourcePropertyLike,
  definitions: PropertyDefinition[] = [],
  options: { fallbackTarget?: string; targetValues?: string[] } = {},
): SourcePropertyClassification {
  const fallbackTarget = options.fallbackTarget ?? "skip";
  const match = findSourcePropertyDefinition(property, definitions, options.targetValues);
  if (match) {
    return {
      status: "suggested",
      displayName: match.definition.label,
      targetValue: match.definition.field,
      confidence: confidenceFromScore(match.score),
      reason: "property registry의 source alias와 일치합니다.",
    };
  }

  const hiddenRule = findHiddenSourcePropertyRule(property);
  if (hiddenRule) {
    return {
      status: "hidden",
      displayName: hiddenRule.label,
      targetValue: fallbackTarget,
      confidence: 0.9,
      reason: hiddenRule.reason,
    };
  }

  return {
    status: "unmapped",
    displayName: property.name,
    targetValue: fallbackTarget,
    confidence: 0,
    reason: "아직 registry에 매핑 규칙이 없습니다.",
  };
}

export function getSourcePropertyDisplayName(property: SourcePropertyLike, definitions: PropertyDefinition[] = []) {
  return classifySourceProperty(property, definitions).displayName;
}

export function guessSourcePropertyTarget(
  property: SourcePropertyLike,
  definitions: PropertyDefinition[] = [],
  options: { fallbackTarget?: string; targetValues?: string[] } = {},
) {
  return classifySourceProperty(property, definitions, options).targetValue;
}

function findSourcePropertyDefinition(property: SourcePropertyLike, definitions: PropertyDefinition[], targetValues?: string[]) {
  const allowedTargets = targetValues?.length ? new Set(targetValues) : null;
  const matches = definitions
    .filter((definition) => !allowedTargets || allowedTargets.has(definition.field))
    .map<SourcePropertyMatch | null>((definition) => {
      const aliases = [definition.field, definition.label, ...(definition.sourceAliases ?? [])];
      const score = Math.max(...aliases.map((alias) => sourceAliasScore(property.name, alias)));
      return score > 0 ? { definition, score } : null;
    })
    .filter((match): match is SourcePropertyMatch => Boolean(match))
    .sort((left, right) => right.score - left.score);

  return matches[0] ?? null;
}

function findHiddenSourcePropertyRule(property: SourcePropertyLike) {
  return COMMON_HIDDEN_SOURCE_PROPERTY_RULES.find((rule) =>
    rule.aliases.some((alias) => sourceAliasScore(property.name, alias) >= 100),
  );
}

function sourceAliasScore(rawName: string, rawAlias: string) {
  const name = normalizeSourcePropertyName(rawName);
  const alias = normalizeSourcePropertyName(rawAlias);
  if (!name || !alias) return 0;
  if (name === alias) return 120 + alias.length;
  if (hasWholePhrase(name, alias)) return 90 + alias.length;
  if (alias.length >= 4 && name.includes(alias)) return 60 + alias.length;
  return 0;
}

function hasWholePhrase(name: string, alias: string) {
  return new RegExp(`(^|\\s)${escapeRegExp(alias)}(\\s|$)`).test(name);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function confidenceFromScore(score: number) {
  if (score >= 120) return 0.96;
  if (score >= 90) return 0.82;
  return 0.64;
}
