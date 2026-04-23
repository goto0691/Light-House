import "server-only";

import JSZip from "jszip";

import { resolveCurrentUser } from "@/lib/server/session-user";

type RestoreManifest = {
  exportedAt?: string;
  domains?: string[];
  format?: string;
};

type RestoreDryRunResult = {
  fileName: string;
  valid: boolean;
  manifest: {
    exportedAt: string | null;
    domains: string[];
    format: string | null;
  };
  counts: Record<string, number>;
  warnings: string[];
};

function countFromSnapshot(domain: string, payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return 0;
  }

  const data = payload as Record<string, unknown>;

  if (domain === "action-hub") {
    return [Array.isArray(data.projects) ? data.projects.length : 0, Array.isArray(data.tasks) ? data.tasks.length : 0, Array.isArray(data.pendingCaptures) ? data.pendingCaptures.length : 0].reduce((sum, value) => sum + value, 0);
  }
  if (domain === "life-ops") {
    return Object.values(data).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  }
  if (domain === "prm") {
    return [Array.isArray(data.people) ? data.people.length : 0, Array.isArray(data.gifts) ? data.gifts.length : 0, Array.isArray(data.networkEdges) ? data.networkEdges.length : 0].reduce((sum, value) => sum + value, 0);
  }
  if (domain === "vault") {
    return [Array.isArray(data.zettels) ? data.zettels.length : 0, Array.isArray(data.media) ? data.media.length : 0, Array.isArray(data.assets) ? data.assets.length : 0, Array.isArray(data.places) ? data.places.length : 0].reduce((sum, value) => sum + value, 0);
  }

  return 0;
}

export async function createRestoreDryRun(fileName: string, bytes: Uint8Array): Promise<RestoreDryRunResult> {
  await resolveCurrentUser();

  const warnings: string[] = [];
  const archive = await JSZip.loadAsync(bytes);
  const manifestEntry = archive.file("manifest.json");

  if (!manifestEntry) {
    return {
      fileName,
      valid: false,
      manifest: {
        exportedAt: null,
        domains: [],
        format: null,
      },
      counts: {},
      warnings: ["manifest.json 이 없어 Light House 백업 파일로 확인할 수 없습니다."],
    };
  }

  let manifest: RestoreManifest = {};
  try {
    manifest = JSON.parse(await manifestEntry.async("text")) as RestoreManifest;
  } catch {
    return {
      fileName,
      valid: false,
      manifest: {
        exportedAt: null,
        domains: [],
        format: null,
      },
      counts: {},
      warnings: ["manifest.json 파싱에 실패했습니다."],
    };
  }

  const domains = Array.isArray(manifest.domains) ? manifest.domains : [];
  const counts: Record<string, number> = {};

  for (const domain of domains) {
    const expectedPath =
      domain === "action-hub"
        ? "action-hub/projects-and-tasks.json"
        : domain === "life-ops"
          ? "life-ops/logs.json"
          : domain === "prm"
            ? "prm/people.json"
            : domain === "vault"
              ? "vault/knowledge.json"
              : null;

    if (!expectedPath) {
      warnings.push(`${domain}: 지원하지 않는 도메인이라 건너뜁니다.`);
      continue;
    }

    const entry = archive.file(expectedPath);
    if (!entry) {
      warnings.push(`${domain}: ${expectedPath} 파일이 없습니다.`);
      counts[domain] = 0;
      continue;
    }

    try {
      const payload = JSON.parse(await entry.async("text")) as unknown;
      const count = countFromSnapshot(domain, payload);
      counts[domain] = count;
    } catch {
      warnings.push(`${domain}: JSON 파싱에 실패했습니다.`);
      counts[domain] = 0;
    }
  }

  if (manifest.format && manifest.format !== "json") {
    warnings.push(`현재 복원 드라이런은 json export만 정확히 검증합니다. 입력 포맷: ${manifest.format}`);
  }

  return {
    fileName,
    valid: warnings.every((warning) => !warning.includes("없습니다") && !warning.includes("실패")),
    manifest: {
      exportedAt: manifest.exportedAt ?? null,
      domains,
      format: manifest.format ?? null,
    },
    counts,
    warnings,
  };
}
