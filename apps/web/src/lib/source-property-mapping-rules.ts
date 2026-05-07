import type { PropertyDefinition } from "@/lib/properties/types";
import { classifySourceProperty, type SourcePropertyClassification, type SourcePropertyLike } from "@/lib/properties/source-mapping";
import type { SourcePropertyMappingRule } from "@/lib/source-workbench-types";

const SOURCE_WILDCARD = "*";

export type SourcePropertyMappingRuleScope = {
  sourceDatabase?: string | null;
  canonicalEntityType?: string | null;
  propertyName: string;
  propertyType?: string | null;
};

export function classifySourcePropertyWithMappingRules(
  property: SourcePropertyLike,
  definitions: PropertyDefinition[],
  rules: SourcePropertyMappingRule[],
  options: {
    canonicalEntityType?: string | null;
    fallbackTarget?: string;
    sourceDatabase?: string | null;
    targetValues?: string[];
  } = {},
) {
  const baseClassification = classifySourceProperty(property, definitions, {
    fallbackTarget: options.fallbackTarget,
    targetValues: options.targetValues,
  });
  const rule = findSourcePropertyMappingRule(rules, {
    sourceDatabase: options.sourceDatabase,
    canonicalEntityType: options.canonicalEntityType,
    propertyName: property.name,
    propertyType: property.type,
  });

  if (!rule) return { classification: baseClassification, rule: null };

  return {
    classification: applySourcePropertyMappingRule(rule, baseClassification, definitions, {
      targetValues: options.targetValues,
    }),
    rule,
  };
}

export function findSourcePropertyMappingRule(rules: SourcePropertyMappingRule[], scope: SourcePropertyMappingRuleScope) {
  const sourceDatabase = sourceMappingScopeValue(scope.sourceDatabase);
  const canonicalEntityType = sourceMappingScopeValue(scope.canonicalEntityType);
  const propertyType = sourceMappingScopeValue(scope.propertyType);
  const propertyName = scope.propertyName.trim();
  if (!propertyName) return null;

  const byKey = new Map(rules.map((rule) => [sourcePropertyMappingRuleKey(rule), rule]));
  for (const key of candidateRuleKeys({ sourceDatabase, canonicalEntityType, propertyName, propertyType })) {
    const found = byKey.get(key);
    if (found) return found;
  }

  return null;
}

export function applySourcePropertyMappingRule(
  rule: SourcePropertyMappingRule,
  baseClassification: SourcePropertyClassification,
  definitions: PropertyDefinition[],
  options: { targetValues?: string[] } = {},
): SourcePropertyClassification {
  const targetAllowed = !rule.targetField || !options.targetValues?.length || options.targetValues.includes(rule.targetField);
  const targetDefinition = targetAllowed && rule.targetField ? definitions.find((definition) => definition.field === rule.targetField) : null;
  const displayName = rule.displayLabel ?? targetDefinition?.label ?? baseClassification.displayName;
  const confidence = rule.confidence ?? 1;

  if (rule.status === "hidden") {
    return {
      status: "hidden",
      displayName,
      targetValue: "skip",
      confidence,
      reason: rule.reason ?? "사용자가 전역 원본 컬럼 규칙에서 숨김 처리했습니다.",
    };
  }

  if (rule.status === "needs_review") {
    return {
      status: "unmapped",
      displayName,
      targetValue: targetAllowed ? rule.targetField ?? "skip" : "skip",
      confidence: rule.confidence ?? 0.2,
      reason: rule.reason ?? "사용자가 전역 원본 컬럼 규칙에서 검토 대상으로 표시했습니다.",
    };
  }

  if (rule.targetField && !targetAllowed) {
    return {
      ...baseClassification,
      reason: "전역 매핑 규칙이 있지만 현재 화면의 적용 대상에는 없어 registry 판정을 사용합니다.",
    };
  }

  return {
    status: "suggested",
    displayName,
    targetValue: rule.targetField ?? baseClassification.targetValue,
    confidence,
    reason: rule.reason ?? "사용자가 저장한 전역 원본 컬럼 매핑 규칙입니다.",
  };
}

export function sourcePropertyMappingRuleKey(input: SourcePropertyMappingRuleScope) {
  return [
    sourceMappingScopeValue(input.sourceDatabase),
    sourceMappingScopeValue(input.canonicalEntityType),
    input.propertyName.trim(),
    sourceMappingScopeValue(input.propertyType),
  ].join("|");
}

export function sourceMappingScopeValue(value: string | null | undefined) {
  return value?.trim() || SOURCE_WILDCARD;
}

function candidateRuleKeys(scope: { sourceDatabase: string; canonicalEntityType: string; propertyName: string; propertyType: string }) {
  const sourceDatabases = unique([scope.sourceDatabase, SOURCE_WILDCARD]);
  const canonicalEntityTypes = unique([scope.canonicalEntityType, SOURCE_WILDCARD]);
  const propertyTypes = unique([scope.propertyType, SOURCE_WILDCARD]);
  const keys: string[] = [];

  for (const sourceDatabase of sourceDatabases) {
    for (const canonicalEntityType of canonicalEntityTypes) {
      for (const propertyType of propertyTypes) {
        keys.push(sourcePropertyMappingRuleKey({ sourceDatabase, canonicalEntityType, propertyName: scope.propertyName, propertyType }));
      }
    }
  }

  return keys;
}

function unique(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}
