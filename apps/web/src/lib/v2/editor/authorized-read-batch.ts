/** Drain ordinary failures so a later sibling access denial cannot be swallowed.
 * A denial rejects immediately even if another read is still pending. Attach a
 * rejection handler to every read; callers still fence stale scopes themselves. */
export function authorizedReadBatch<T extends readonly unknown[]>(
  reads: { readonly [K in keyof T]: PromiseLike<T[K]> }, isAccessDenied: (error: unknown) => boolean,
): Promise<T> {
  const captured = [...reads];
  return new Promise<T>((resolve, reject) => {
    const values: unknown[] = new Array(captured.length);
    let remaining = captured.length, failed = false, firstError: unknown;
    const complete = () => { if (--remaining === 0) { if (failed) reject(firstError); else resolve(values as unknown as T); } };
    if (!remaining) { resolve(values as unknown as T); return; }
    // Assimilate even exotic PromiseLike objects asynchronously, so a throwing
    // native Promise constructor/then getter cannot skip later sibling handlers.
    for (const [index, read] of captured.entries()) Promise.resolve().then(() => read).then((value) => {
      values[index] = value; complete();
    }, (error: unknown) => {
      if (!failed) { failed = true; firstError = error; }
      try { if (isAccessDenied(error)) reject(error); } catch (error) { reject(error); }
      complete();
    });
  });
}
