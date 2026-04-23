import "server-only";

import JSZip from "jszip";

import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getLifeOpsSnapshot, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export type ExportDomain = "action-hub" | "life-ops" | "prm" | "vault";
export type ExportFormat = "json" | "markdown";

function assertFormat(value: string | null): ExportFormat {
  if (value === "markdown") return "markdown";
  return "json";
}

export function parseExportDomains(value: string | null): ExportDomain[] {
  if (!value || value === "all") {
    return ["action-hub", "life-ops", "prm", "vault"];
  }

  const supported = new Set<ExportDomain>(["action-hub", "life-ops", "prm", "vault"]);
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is ExportDomain => supported.has(item as ExportDomain));

  return parsed.length ? parsed : ["action-hub", "life-ops", "prm", "vault"];
}

function toMarkdown(title: string, content: unknown) {
  return `# ${title}\n\n\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\`\n`;
}

export async function createExportArchive(input: { domains: ExportDomain[]; format: ExportFormat }) {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const zip = new JSZip();

  const domainSet = new Set(input.domains);

  if (domainSet.has("action-hub")) {
    const snapshot = await getActionHubSnapshot();
    zip.file(
      input.format === "json" ? "action-hub/projects-and-tasks.json" : "action-hub/projects-and-tasks.md",
      input.format === "json" ? JSON.stringify(snapshot, null, 2) : toMarkdown("Action Hub Export", snapshot),
    );
  }

  if (domainSet.has("life-ops")) {
    const snapshot = await getLifeOpsSnapshot();
    zip.file(
      input.format === "json" ? "life-ops/logs.json" : "life-ops/logs.md",
      input.format === "json" ? JSON.stringify(snapshot, null, 2) : toMarkdown("Life Ops Export", snapshot),
    );
  }

  if (domainSet.has("prm")) {
    const snapshot = await getPRMSnapshot();
    zip.file(
      input.format === "json" ? "prm/people.json" : "prm/people.md",
      input.format === "json" ? JSON.stringify(snapshot, null, 2) : toMarkdown("PRM Export", snapshot),
    );
  }

  if (domainSet.has("vault")) {
    const snapshot = await getVaultSnapshot();
    zip.file(
      input.format === "json" ? "vault/knowledge.json" : "vault/knowledge.md",
      input.format === "json" ? JSON.stringify(snapshot, null, 2) : toMarkdown("Vault Export", snapshot),
    );
  }

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        domains: input.domains,
        format: input.format,
      },
      null,
      2,
    ),
  );

  const buffer = await zip.generateAsync({ type: "uint8array" });
  return {
    filename: `light-house-export-${new Date().toISOString().slice(0, 10)}-${input.format}.zip`,
    contentType: "application/zip",
    body: buffer,
  };
}

export { assertFormat };

