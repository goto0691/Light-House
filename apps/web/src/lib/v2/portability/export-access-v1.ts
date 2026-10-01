import type { ExportProfile, ExportScopeV1 } from "@/lib/v2/portability/portability-contract-v1";

type ExportAccessProjection = Readonly<{
  profile: ExportProfile;
  scope: ExportScopeV1;
  bundleObjectKey: unknown;
  bundleSha256: unknown;
  bundleSizeBytes: unknown;
  manifest: unknown;
}>;

export function exportRequiresRecentReauthentication(
  job: Pick<ExportAccessProjection, "profile" | "scope">,
) {
  return job.profile === "migration" || job.scope.privacyLevels.includes("restricted");
}

/**
 * Status and timestamps remain visible so an expired grant does not make an
 * export look lost. Object locations are never public, and protected archive
 * hashes, byte sizes, and manifest counts are redacted until reauthentication.
 */
export function exportJobForSession<T extends ExportAccessProjection>(
  job: T,
  restrictedUnlocked: boolean,
): Omit<T, "bundleObjectKey"> {
  const { bundleObjectKey: _objectKey, ...safe } = job;
  if (!restrictedUnlocked && exportRequiresRecentReauthentication(job)) {
    return {
      ...safe,
      bundleSha256: null,
      bundleSizeBytes: null,
      manifest: null,
    };
  }
  return safe;
}
