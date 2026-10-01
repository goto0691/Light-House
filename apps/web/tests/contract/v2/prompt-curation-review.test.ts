import { expect, test } from "vitest";

import { linkSha256Hex as sha } from "@/lib/v2/domain/link-snapshot-v1";
import {
  copyPromptCuration, extractManualPromptFragment, preparePromptCuration,
  type PromptCopyRole, type PromptCurationInput, type PromptCurationItem, type PromptCurationSource,
} from "@/lib/v2/domain/prompt-curation-v1";

async function source(rawText: string, memberKey = "source", part = 1, total = 1): Promise<PromptCurationSource> {
  return { memberKey, rawText, contentHash: await sha(rawText), sourceFingerprint: await sha(`fingerprint:${memberKey}:${rawText}`),
    completeness: "complete", parts: { number: { value: part, origin: "source_explicit" }, total: { value: total, origin: "source_explicit" } } };
}
async function item(member: PromptCurationSource, role: PromptCopyRole = "prompt", position = 0): Promise<PromptCurationItem> {
  return { itemKey: `${member.memberKey}:${role}:${position}`, copyRole: role, position,
    fragment: await extractManualPromptFragment(member, { textStart: 0, textEnd: member.rawText.length, role }) };
}
async function curation(sources: readonly PromptCurationSource[], items?: readonly PromptCurationItem[]): Promise<PromptCurationInput> {
  return { snapshotManifestHash: await sha("snapshot"), title: "Independent curation review", relationKind: "continuation",
    relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed", separator: "\n", sources,
    items: items ?? await Promise.all(sources.map((member, index) => item(member, "prompt", index))), examples: [] };
}

test("manual extraction cannot validate one source string and return another after an async mutation", async () => {
  const member = await source("original");
  const pending = extractManualPromptFragment(member, { textStart: 0, textEnd: 8, role: "prompt" });
  Object.assign(member, { rawText: "replaced" });
  const outcome = await pending.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
  if (outcome.error) expect(outcome.error).toMatchObject({ name: "PromptCurationError" });
  else {
    // A synchronous defensive snapshot or a fail-closed revalidation is safe.
    // Returning replacement bytes with the old source hash is neither.
    expect(outcome.value?.rawText).toBe("original");
    expect(outcome.value?.rawTextHash).toBe(member.contentHash);
  }
});

test("manual extraction uses the requested range and role from one stable input snapshot", async () => {
  const member = await source("first second"), selection = { textStart: 0, textEnd: 5, role: "prompt" as PromptCopyRole };
  const pending = extractManualPromptFragment(member, selection);
  Object.assign(selection, { textStart: 6, textEnd: 12, role: "negative_prompt" });
  const outcome = await pending.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
  if (outcome.error) expect(outcome.error).toMatchObject({ name: "PromptCurationError" });
  else expect(outcome.value).toMatchObject({ rawText: "first", textStart: 0, textEnd: 5, role: "prompt" });
});

test("a curation manifest cannot certify changed fragment bytes with the pre-await source hash", async () => {
  const member = await source("original"), value = await curation([member]);
  const replacementHash = await sha("replaced");
  const pending = preparePromptCuration(value);
  Object.assign(member, { rawText: "replaced" });
  Object.assign(value.items[0].fragment, { rawText: "replaced", rawTextHash: replacementHash });
  const outcome = await pending.then((prepared) => ({ prepared, error: null }), (error: unknown) => ({ prepared: null, error }));
  if (outcome.error) expect(outcome.error).toMatchObject({ name: "PromptCurationError" });
  else {
    const manifest = JSON.parse(outcome.prepared!.manifestJson);
    expect(manifest.items[0].sourceContentHash).toBe(await sha("original"));
    // This whole-source selection must describe the same immutable bytes.
    expect(manifest.items[0].rawTextHash).toBe(manifest.items[0].sourceContentHash);
  }
});

test("copy cannot substitute unhashed source bytes while its source digest is pending", async () => {
  const member = await source("original"), value = await curation([member]);
  const replacementHash = await sha("replaced");
  const pending = copyPromptCuration(value, { role: "prompt", mode: "standard" });
  Object.assign(member, { rawText: "replaced" });
  Object.assign(value.items[0].fragment, { rawText: "replaced", rawTextHash: replacementHash });
  const outcome = await pending.then((copied) => ({ copied, error: null }), (error: unknown) => ({ copied: null, error }));
  if (outcome.error) expect(outcome.error).toMatchObject({ name: "PromptCurationError" });
  else expect(outcome.copied?.text).toBe("original");
});

test("a complete two-post prompt/negative curation must not invent missing posts for either role", async () => {
  const positive = await source("landscape, soft light", "post-1", 1, 2);
  const negative = await source("blur, watermark", "post-2", 2, 2);
  const value = await curation([positive, negative], [await item(positive), await item(negative, "negative_prompt")]);
  const prepared = await preparePromptCuration(value);
  // Post 2 is preserved and selected as negative, not an absent positive part.
  // Source acquisition coverage and role assembly coverage are distinct.
  expect(prepared.channels.prompt.warnings).not.toContain("missing_parts");
  expect(prepared.channels.negative_prompt.warnings).not.toContain("missing_parts");
});

test("an unselected catalog source cannot silently fill a gap in the confirmed curation", async () => {
  const first = await source("first", "post-1", 1, 3), unselected = await source("unselected", "post-2", 2, 3), last = await source("last", "post-3", 3, 3);
  const value = await curation([first, unselected, last], [await item(first), await item(last, "negative_prompt")]);
  const channels = (await preparePromptCuration(value)).channels;
  expect(channels.prompt.warnings).toContain("missing_parts");
  expect(channels.negative_prompt.warnings).toContain("missing_parts");
  expect(channels.prompt.canStandardCopy).toBe(false);
  expect(channels.negative_prompt.canStandardCopy).toBe(false);
});

test("an AI selection warning remains visible while copying its exact confirmed-order source slices", async () => {
  const member = await source("  exact AI-selected text\r\n"), value = await curation([member]);
  const selected: PromptCurationInput = { ...value, items: value.items.map((entry) => ({ ...entry,
    fragment: { ...entry.fragment, completeness: "selection_unverified", selectionOrigin: "ai_selected" } })) };
  const copied = await copyPromptCuration(selected, { role: "prompt", mode: "standard" });
  expect(copied.text).toBe(member.rawText);
  expect(copied.warnings).toContain("selection_unverified");
  expect(copied.coverage.externalScope).toBe("unverified");
  expect(copied.kind).toBe("assembled_source_fragments");
});

test("unconfirmed image correspondence does not block unrelated exact text copying or imply generation proof", async () => {
  const member = await source("prompt"), value = await curation([member]);
  const input: PromptCurationInput = { ...value, examples: [{ exampleKey: "example", itemKey: value.items[0].itemKey,
    memberKey: "image-member", sourceFingerprint: await sha("image-source"), sha256: await sha("image-bytes"), mimeType: "image/png",
    sizeBytes: 20, position: 0, evidenceMethod: "unresolved" }] };
  const copied = await copyPromptCuration(input, { role: "prompt", mode: "standard" });
  expect(copied.text).toBe("prompt");
  expect(copied.warnings).toContain("image_pair_unconfirmed");
  const manifest = JSON.parse((await preparePromptCuration(input)).manifestJson);
  expect(manifest.examples[0].evidenceMethod).toBe("unresolved");
  expect(manifest.examples[0]).not.toHaveProperty("generatedBy");
});
