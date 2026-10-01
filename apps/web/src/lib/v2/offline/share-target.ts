import type { LocalAttachmentInput, LocalDraftCheckpoint, LocalSourceItem } from "@/lib/v2/offline/local-capture";

function nonEmptyFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseShareTargetFormData(
  formData: FormData,
  input: { draftId: string; now?: string; timezone: string },
): LocalDraftCheckpoint {
  const title = nonEmptyFormValue(formData, "title");
  const text = nonEmptyFormValue(formData, "text");
  const url = nonEmptyFormValue(formData, "url");
  const sourceItems: LocalSourceItem[] = [];
  const attachments: LocalAttachmentInput[] = [];
  let order = 0;

  for (const [kind, value] of [
    ["title", title],
    ["text", text],
    ["url", url],
  ] as const) {
    if (!value) continue;
    sourceItems.push({ sourceId: `${input.draftId}:source:${order}`, order, kind, value });
    order += 1;
  }

  for (const entry of formData.getAll("files")) {
    if (!(entry instanceof Blob) || entry.size === 0) continue;
    const filename = "name" in entry && typeof entry.name === "string" ? entry.name : `shared-${order}`;
    const localAttachmentId = `${input.draftId}:attachment:${order}`;
    attachments.push({ localAttachmentId, blob: entry, filename, sourceOrder: order });
    sourceItems.push({ sourceId: `${input.draftId}:source:${order}`, order, kind: "attachment", value: localAttachmentId });
    order += 1;
  }

  const bodyMarkdown = [title ? `# ${title}` : null, text, url ? `<${url}>` : null].filter(Boolean).join("\n\n");
  const now = input.now ?? new Date().toISOString();
  return {
    draftId: input.draftId,
    bodyMarkdown,
    captureChannel: "mobile_share",
    privacyLevel: "normal",
    sourceItems,
    attachments,
    createdAt: now,
    updatedAt: now,
    clientTimezone: input.timezone,
    localVersion: 1,
  };
}
