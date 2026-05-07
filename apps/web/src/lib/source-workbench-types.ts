import type { SourcePropertyClassification } from "@/lib/properties/source-mapping";

export type SourceMappingClassificationStatus = SourcePropertyClassification["status"];

export type SourcePropertyMappingRuleStatus = "mapped" | "hidden" | "needs_review";

export type SourcePropertyMappingRule = {
  id: string;
  sourceDatabase: string;
  canonicalEntityType: string;
  propertyName: string;
  propertyType: string;
  status: SourcePropertyMappingRuleStatus;
  targetField: string | null;
  displayLabel: string | null;
  reason: string | null;
  confidence: number | null;
  updatedAt: string | null;
};

export type SourceWorkbenchTargetOption = {
  value: string;
  label: string;
  group: string;
};

export type SourceWorkbenchProperty = {
  id: string;
  sourceDatabase: string | null;
  canonicalEntityType: string | null;
  propertyEntityType: string | null;
  documentRole: string | null;
  documentStatus: string;
  propertyName: string;
  propertyType: string | null;
  occurrences: number;
  documentCount: number;
  sampleValue: string | null;
  classification: SourcePropertyClassification;
  overrideRule: Pick<SourcePropertyMappingRule, "id" | "status" | "targetField" | "displayLabel" | "reason" | "updatedAt"> | null;
  review: {
    openCount: number;
    totalCount: number;
    sampleReviewItemId: string | null;
    updatedAt: string | null;
  };
  targetOptions: SourceWorkbenchTargetOption[];
};

export type SourceWorkbenchSummary = {
  totalProperties: number;
  suggested: number;
  unmapped: number;
  hidden: number;
  openReviewItems: number;
  overrideRules: number;
  sourceDatabases: number;
  entityTypes: number;
};

export type SourcePropertyWorkbench = {
  rows: SourceWorkbenchProperty[];
  summary: SourceWorkbenchSummary;
  filters: {
    sourceDatabases: string[];
    entityTypes: string[];
    documentRoles: string[];
  };
};

export type SourcePropertyMappingMutationInput = {
  sourceDatabase?: string | null;
  canonicalEntityType?: string | null;
  propertyName: string;
  propertyType?: string | null;
  documentRole?: string | null;
  documentStatus?: string | null;
  status: SourcePropertyMappingRuleStatus;
  targetField?: string | null;
  displayLabel?: string | null;
  reason?: string | null;
  confidence?: number | null;
};

export type SourcePropertyBatchApplyInput = {
  sourceDatabase?: string | null;
  canonicalEntityType?: string | null;
  propertyName: string;
  propertyType?: string | null;
  documentRole?: string | null;
  documentStatus?: string | null;
  targetField: string;
  overwrite?: boolean;
  limit?: number;
};

export type SourcePropertyBatchApplyResult = {
  matchedDocuments: number;
  applied: number;
  skippedExisting: number;
  skippedInvalid: number;
  skippedUnlinked: number;
  unsupported: number;
  targetLabel: string;
};
