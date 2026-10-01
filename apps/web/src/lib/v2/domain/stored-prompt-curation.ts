import type { PromptCurationContent } from "@/lib/v2/domain/prompt-curation-request";
import type { PreparedPromptCuration, PromptCurationExample, PromptCurationItem } from "@/lib/v2/domain/prompt-curation-v1";

export const STORED_PROMPT_CURATION_CONTRACT = "stored-prompt-curation.v1" as const;
export const PROMPT_CURATION_PAGE_SIZE = 20;
export type PromptCurationSummary = Readonly<{
  id: string; groupKey: string; snapshotId: string; revisionNumber: number; parentRevisionId: string | null; basedOnRevisionId: string | null;
  changeReason: "create" | "edit" | "undo" | "archive" | "unarchive" | "migrate"; title: string;
  relationKind: PromptCurationContent["relationKind"]; status: "active" | "archived"; createdAt: string; manifestHash: string;
}>;
export type StoredPromptCuration = PromptCurationSummary & Readonly<{
  content: PromptCurationContent; prepared: PreparedPromptCuration;
  items: readonly PromptCurationItem[]; examples: readonly PromptCurationExample[];
}>;
export type PromptCurationReceipt = Readonly<{ contract: typeof STORED_PROMPT_CURATION_CONTRACT; item: StoredPromptCuration; replayed: boolean }>;
export type PromptCurationPage = Readonly<{ contract: typeof STORED_PROMPT_CURATION_CONTRACT; recordId: string;
  currentRevisionId: string; currentSnapshotId: string | null; selectedSnapshotId: string | null; isHistorical: boolean;
  items: readonly PromptCurationSummary[]; nextCursor: string | null }>;
export type PromptCurationDetail = Readonly<{ contract: typeof STORED_PROMPT_CURATION_CONTRACT; recordId: string;
  currentRevisionId: string; currentSnapshotId: string | null; isHistorical: boolean; item: StoredPromptCuration;
  head: Readonly<{ id: string; revisionNumber: number }>; history: Readonly<{ items: readonly PromptCurationSummary[]; nextCursor: string | null }> }>;
