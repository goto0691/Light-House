type Identity = Readonly<{ ownerId: string; recordId: string }>;
const subscribers = new Map<string, Set<() => void>>();
const keyOf = ({ ownerId, recordId }: Identity) => JSON.stringify([ownerId, recordId]);

/** Browser-realm cancellation only: never grants access or invents a server
 * privacy level. Unmount/navigation and explicit access revocation differ. */
export function onLinkDraftAccessRevoked(identity: Identity, stop: () => void): () => void {
  const key = keyOf(identity), listeners = subscribers.get(key) ?? new Set<() => void>();
  listeners.add(stop); subscribers.set(key, listeners);
  return () => { listeners.delete(stop); if (!listeners.size && subscribers.get(key) === listeners) subscribers.delete(key); };
}
export function revokeLinkDraftAccess(identity: Identity): void {
  for (const stop of [...(subscribers.get(keyOf(identity)) ?? [])]) {
    try { stop(); } catch { /* One failing view must not prevent the others or parent from closing. */ }
  }
}
