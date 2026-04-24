"use client";

export type OfflineCapturePayload = {
  text: string;
  context?: {
    domain?: string;
    label?: string;
    projectId?: string | null;
    personId?: string | null;
    forceDomain?: string;
  };
};

type OfflineCaptureEntry = {
  id: string;
  createdAt: string;
  payload: OfflineCapturePayload;
};

const DB_NAME = "project-light-house-offline";
const STORE_NAME = "quick-captures";
const DB_VERSION = 1;
const FALLBACK_KEY = "light-house:offline-captures";

function emitQueueChanged() {
  window.dispatchEvent(new CustomEvent("offline-captures:changed"));
}

function hasIndexedDB() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openQueueDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void) {
  const db = await openQueueDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = run(store);
    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    };
  });
}

function readFallback() {
  try {
    return JSON.parse(window.localStorage.getItem(FALLBACK_KEY) ?? "[]") as OfflineCaptureEntry[];
  } catch {
    return [];
  }
}

function writeFallback(entries: OfflineCaptureEntry[]) {
  window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(entries));
}

export async function queueOfflineCapture(payload: OfflineCapturePayload) {
  const entry: OfflineCaptureEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload,
  };

  if (hasIndexedDB()) {
    await withStore("readwrite", (store) => store.put(entry));
  } else {
    writeFallback([...readFallback(), entry]);
  }
  emitQueueChanged();
  return entry;
}

export async function listOfflineCaptures() {
  if (!hasIndexedDB()) return readFallback();
  const entries = await withStore<OfflineCaptureEntry[]>("readonly", (store) => store.getAll());
  return entries ?? [];
}

async function removeOfflineCapture(id: string) {
  if (hasIndexedDB()) {
    await withStore("readwrite", (store) => store.delete(id));
  } else {
    writeFallback(readFallback().filter((entry) => entry.id !== id));
  }
  emitQueueChanged();
}

export async function countOfflineCaptures() {
  return (await listOfflineCaptures()).length;
}

export async function flushOfflineCaptures() {
  const entries = await listOfflineCaptures();
  let flushed = 0;

  for (const entry of entries) {
    const response = await fetch("/api/action-hub/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry.payload),
    });
    if (!response.ok) break;
    await removeOfflineCapture(entry.id);
    flushed += 1;
  }

  return { flushed, remaining: Math.max(entries.length - flushed, 0) };
}
