export type PresentedValueRenderer = "text" | "number" | "boolean" | "date" | "rating" | "json";

export type PresentedEvidence = Readonly<{
  evidenceId: string;
  sourceItemId: string | null;
  locatorKind: string;
  locator: Readonly<Record<string, unknown>>;
  quote: string | null;
}>;

export type PresentedField = Readonly<{
  propertyId: string;
  fieldKey: string;
  label: string;
  dataType: string;
  value: unknown;
  renderer: PresentedValueRenderer;
  sourceClass: string;
  sourceLabel: string;
  claimRisk: "low" | "autobiographical" | "social_high_risk";
  reviewStatus: "accepted" | "proposed" | "disputed";
  lockedByUser: boolean;
  evidence: readonly PresentedEvidence[];
}>;

export type PresentedReviewItem = Readonly<{
  reviewId: string;
  kind: "registry_conflict" | "value_conflict" | "high_risk_claim" | "analysis_review" | "analysis_warning";
  payload: Readonly<Record<string, unknown>>;
  field: PresentedField | null;
  requiresHighRiskConfirmation: boolean;
}>;

export type PresentedConnection = Readonly<{
  relationId: string;
  predicateKey: string;
  predicateLabel: string;
  targetObjectId: string;
  targetKind: "entity" | "event" | "document";
  targetLabel: string;
  sourceLabel: string;
  evidence: readonly PresentedEvidence[];
}>;

export type RecordKnowledgePresentation = Readonly<{
  contractVersion: "record-presentation-v1";
  displayType: Readonly<{
    typeKey: string | null;
    label: string;
    iconKey: string;
    status: "candidate" | "observed" | "active" | "fallback";
    tentative: boolean;
    recordPresetKey: string;
  }>;
  highlights: readonly PresentedField[];
  sections: readonly Readonly<{ key: "user_facts" | "external_facts" | "topics" | "other"; title: string; fields: readonly PresentedField[] }>[];
  connections: readonly PresentedConnection[];
  modules: readonly import("@/lib/v2/presentation/extension-registry").PresentedContextModule[];
  reviewItems: readonly PresentedReviewItem[];
}>;
