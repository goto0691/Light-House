const form = document.querySelector("#capture-form");
const body = document.querySelector("#body");
const files = document.querySelector("#files");
const status = document.querySelector("#status");

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lighthouse_capture_v1", 2);
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
    transaction.onabort = () => reject(transaction.error || new Error("저장 트랜잭션이 중단되었습니다."));
  });
}

async function hash(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = Array.from(files.files || []).slice(0, 3);
  const submit = form.querySelector("button");
  submit.disabled = true;
  status.textContent = "이 기기에 저장하는 중…";
  try {
    const draftId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const attachmentRows = [];
    for (const [index, file] of selected.entries()) {
      attachmentRows.push({
        localAttachmentId: `${draftId}:attachment:${index}`,
        draftId,
        blob: file,
        filename: file.name,
        mime: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await hash(file),
        sourceOrder: index + 1,
        createdAt: timestamp,
        uploadProgress: 0,
        uploadStatus: "pending",
        reservationId: null,
        reservationExpiresAt: null,
        attempt: 0,
        nextAttemptAt: null,
        lastErrorClass: null,
      });
    }
    const payloadHash = await hash(JSON.stringify({ body: body.value, hashes: attachmentRows.map((row) => row.sha256) }));
    const draft = {
      draftId,
      title: null,
      bodyMarkdown: body.value,
      aiEnabled: true,
      captureChannel: "web",
      privacyLevel: "normal",
      templateVersionId: null,
      templateValues: [],
      attachmentIds: attachmentRows.map((row) => row.localAttachmentId),
      sourceItems: [],
      createdAt: timestamp,
      capturedAt: timestamp,
      updatedAt: timestamp,
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localVersion: 1,
      state: "local_saved",
    };
    const database = await openDatabase();
    const transaction = database.transaction(["drafts", "attachment_blobs", "outbox"], "readwrite");
    transaction.objectStore("drafts").put(draft);
    for (const attachment of attachmentRows) transaction.objectStore("attachment_blobs").put(attachment);
    transaction.objectStore("outbox").put({
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
    });
    await transactionDone(transaction);
    database.close();
    status.textContent = "이 기기에 임시 저장했습니다. 앱을 다시 열면 전송을 계속합니다.";
    body.value = "";
    files.value = "";
  } catch {
    status.textContent = "저장하지 못했습니다. 브라우저 저장 공간을 확인하고 다시 시도하세요.";
  } finally {
    submit.disabled = false;
  }
});
