export type EntityType =
  | "project"
  | "task"
  | "zettel"
  | "media"
  | "person"
  | "daily_log"
  | "daily_entry"
  | "workout"
  | "career"
  | "gift"
  | "interaction"
  | "place"
  | "asset"
  | "source_document"
  | "tag";

export type RelationKind = "explicit" | "source" | "mention" | "inferred" | "semantic";

export type ContextLensKey =
  | "overview"
  | "people"
  | "projects"
  | "zettels"
  | "media"
  | "dates"
  | "places"
  | "source"
  | "unresolved";

export type ContextNode = {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  preview?: string;
  icon?: string;
  tone?: "gold" | "info" | "success" | "warning" | "danger" | "muted";
  sourceDocumentId?: string;
  disambiguationLabel?: string;
};

export type ContextEdgeEvidence = {
  source: "table" | "source_document" | "editor" | "ai" | "search";
  table?: string;
  sourceDocumentId?: string;
  propertyName?: string;
  snippet?: string;
};

export type ContextEdge = {
  id: string;
  from: { type: EntityType; id: string };
  to: { type: EntityType; id: string };
  label: string;
  kind: RelationKind;
  confidence: number;
  evidence: ContextEdgeEvidence[];
  createdAt?: string;
};

export type ContextTimelineItem = {
  date: string;
  nodes: ContextNode[];
  edges: ContextEdge[];
};

export type ContextBundle = {
  focus: ContextNode;
  nodes: ContextNode[];
  edges: ContextEdge[];
  summary?: {
    nodeCount: number;
    edgeCount: number;
  };
  pages?: Partial<Record<ContextLensKey, ContextNode[]>>;
  pagination?: Partial<Record<ContextLensKey, {
    cursor: string;
    hasMore: boolean;
    limit: number;
    nextCursor?: string;
    total: number;
  }>>;
  grouped: {
    people: ContextNode[];
    projects: ContextNode[];
    zettels: ContextNode[];
    media: ContextNode[];
    dates: ContextNode[];
    places: ContextNode[];
    source: ContextNode[];
    unresolved: ContextNode[];
  };
  timeline: ContextTimelineItem[];
  quality: {
    unresolvedCount: number;
    lowConfidenceCount: number;
    duplicateSuspects: number;
  };
};

export type ContextSearchResult = ContextNode & {
  score: number;
};

export type SourceTraceProperty = {
  id: string;
  propertyKey: string;
  propertyName: string;
  propertyType?: string;
  valueText?: string;
  valueJson?: string;
  normalizedValue?: string;
};

export type SourceTraceRelation = {
  id: string;
  relationName: string;
  targetSourceId?: string;
  targetTitle?: string;
  resolvedEntityType?: EntityType;
  resolvedEntityId?: string;
  confidence?: number;
  createdAt?: string;
};

export type SourceTraceReviewItem = {
  id: string;
  entityType: EntityType;
  entityId?: string;
  issueType: string;
  suggestedAction: string;
  confidence?: number;
  status: "open" | "dismissed" | "applied" | string;
  reason?: string;
  resolvedAt?: string;
  updatedAt?: string;
};

export type SourceTraceDocument = {
  id: string;
  sourceType: string;
  sourceId: string;
  importBatchId?: string;
  sourceDatabase?: string;
  title: string;
  documentRole?: string;
  canonicalEntityType?: EntityType;
  canonicalEntityId?: string;
  status: string;
  url?: string;
  rawContentPreview?: string;
  resolvedAt?: string;
  updatedAt?: string;
  properties: SourceTraceProperty[];
  relations: SourceTraceRelation[];
  reviewItems: SourceTraceReviewItem[];
};
