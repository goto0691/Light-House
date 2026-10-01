const CACHE_NAME = "lighthouse-shell-v2";
const SHELL_ASSETS = ["/offline-capture.html", "/offline-capture.js", "/v2-icon-192.png", "/v2-icon-512.png"];
const DB_NAME = "lighthouse_capture_v1";
const DB_VERSION = 2;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("lighthouse-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function openCaptureDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = event.target.transaction;
      if (event.oldVersion < 1) {
        const drafts = database.createObjectStore("drafts", { keyPath: "draftId" });
        drafts.createIndex("by-updatedAt", "updatedAt");
        const attachments = database.createObjectStore("attachment_blobs", { keyPath: "localAttachmentId" });
        attachments.createIndex("by-draftId", "draftId");
        const outbox = database.createObjectStore("outbox", { keyPath: "operationId" });
        outbox.createIndex("by-draftId", "draftId");
        outbox.createIndex("by-idempotencyKey", "idempotencyKey", { unique: true });
        const receipts = database.createObjectStore("receipts", { keyPath: "draftId" });
        receipts.createIndex("by-committedAt", "committedAt");
      }
      if (event.oldVersion < 2) {
        const outbox = transaction.objectStore("outbox");
        if (!outbox.indexNames.contains("by-nextAttemptAt")) outbox.createIndex("by-nextAttemptAt", "nextAttemptAt");
        const sensitiveDrafts = database.createObjectStore("sensitive_drafts", { keyPath: "draftId" });
        sensitiveDrafts.createIndex("by-updatedAt", "updatedAt");
        const sensitiveAttachments = database.createObjectStore("sensitive_attachment_blobs", { keyPath: "localAttachmentId" });
        sensitiveAttachments.createIndex("by-draftId", "draftId");
        database.createObjectStore("device_keys", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readText(formData, key) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function persistSharedDraft(formData) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const title = readText(formData, "title");
  const text = readText(formData, "text");
  const url = readText(formData, "url");
  const sourceItems = [];
  const attachmentRows = [];
  let order = 0;

  for (const [kind, value] of [["title", title], ["text", text], ["url", url]]) {
    if (!value) continue;
    sourceItems.push({ sourceId: `${draftId}:source:${order}`, order, kind, value });
    order += 1;
  }
  for (const file of formData.getAll("files")) {
    if (!(file instanceof Blob) || file.size === 0) continue;
    const localAttachmentId = `${draftId}:attachment:${order}`;
    attachmentRows.push({
      localAttachmentId,
      draftId,
      blob: file,
      filename: file.name || `shared-${order}`,
      mime: file.type || "application/octet-stream",
      bytes: file.size,
      sha256: await sha256(file),
      sourceOrder: order,
      createdAt: timestamp,
      uploadProgress: 0,
      uploadStatus: "pending",
      reservationId: null,
      reservationExpiresAt: null,
      attempt: 0,
      nextAttemptAt: null,
      lastErrorClass: null,
    });
    sourceItems.push({ sourceId: `${draftId}:source:${order}`, order, kind: "attachment", value: localAttachmentId });
    order += 1;
  }

  const bodyMarkdown = [title ? `# ${title}` : null, text, url ? `<${url}>` : null].filter(Boolean).join("\n\n");
  const payloadHash = await sha256(JSON.stringify({ bodyMarkdown, sourceItems, hashes: attachmentRows.map((row) => row.sha256) }));
  const draft = {
    draftId,
    title,
    bodyMarkdown,
    aiEnabled: true,
    captureChannel: "mobile_share",
    privacyLevel: "normal",
    templateVersionId: null,
    templateValues: [],
    attachmentIds: attachmentRows.map((row) => row.localAttachmentId),
    sourceItems,
    createdAt: timestamp,
    capturedAt: timestamp,
    updatedAt: timestamp,
    clientTimezone: "UTC",
    localVersion: 1,
    state: "local_saved",
  };
  const outbox = {
    operationId: `commit:${draftId}:1`,
    draftId,
    idempotencyKey: `local-source:${draftId}:${payloadHash}`,
    dependencyOperationIds: attachmentRows.map((row) => `upload:${row.localAttachmentId}`),
    attempt: 0,
    nextAttemptAt: timestamp,
    lastErrorClass: null,
    payloadHash,
    createdAt: timestamp,
    serverReceipt: null,
  };

  const database = await openCaptureDb();
  const transaction = database.transaction(["drafts", "attachment_blobs", "outbox"], "readwrite");
  transaction.objectStore("drafts").put(draft);
  for (const attachment of attachmentRows) transaction.objectStore("attachment_blobs").put(attachment);
  transaction.objectStore("outbox").put(outbox);
  await transactionDone(transaction);
  database.close();
  return draftId;
}

async function handleShareTarget(request) {
  try {
    const draftId = await persistSharedDraft(await request.formData());
    return Response.redirect(`/v2/capture?draftId=${encodeURIComponent(draftId)}&from=share`, 303);
  } catch {
    return Response.redirect("/v2/capture?shareError=local-save", 303);
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  if (url.origin !== self.location.origin) return;
  if (["/v2-lab", "/v2/capture", "/share-target"].includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline-capture.html")));
    return;
  }
  // Keep the legacy navigation fallback without caching authenticated pages,
  // attachment responses, or other user data in a general-purpose cache.
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ko"><title>Light House Offline</title><main style="font-family:sans-serif;padding:24px">오프라인입니다. 다시 연결한 뒤 계속하세요.</main></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )));
});
