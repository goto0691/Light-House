import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";

export function getV2CloudflareBindings() {
  const { env } = getCloudflareContext();
  const { DB } = env;

  if (!DB) {
    throw new Error("The Cloudflare DB binding is not available in this runtime.");
  }

  return { db: DB as D1DatabaseBinding };
}

export function getV2ArchiveAssetsBucket() {
  const { env } = getCloudflareContext();
  const { ARCHIVE_ASSETS } = env;

  if (!ARCHIVE_ASSETS) {
    throw new Error("The Cloudflare ARCHIVE_ASSETS binding is not available in this runtime.");
  }

  return ARCHIVE_ASSETS as R2BucketBinding;
}

export const getV2PortabilityBucket = getV2ArchiveAssetsBucket;
