import { NextResponse } from "next/server";

import type { SearchItem } from "@/lib/mock/search";
import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const types = searchParams
    .get("types")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const startedAt = Date.now();
  await Promise.all([seedActionHubSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const [actionHub, prm, vault] = await Promise.all([getActionHubSnapshot(), getPRMSnapshot(), getVaultSnapshot()]);
  const normalized = q.trim().toLowerCase();

  const rawItems: SearchItem[] = [
    ...actionHub.tasks.map((task) => ({
      type: "task" as const,
      id: task.id,
      title: task.title,
      snippet: task.content,
      href: task.projectId ? `/action-hub/${task.projectId}/tasks/${task.id}` : "/action-hub/inbox",
      score: 0.95,
    })),
    ...prm.people.map((person) => ({
      type: "person" as const,
      id: person.id,
      title: person.name,
      snippet: `${person.groups.join(" · ")} · 최근 연락 ${person.daysSinceContact}일 전`,
      href: `/prm?detail=person:${person.id}`,
      score: 0.92,
    })),
    ...vault.zettels.map((zettel) => ({
      type: "zettel" as const,
      id: zettel.id,
      title: zettel.title,
      snippet: zettel.summary,
      href: `/vault?detail=zettel:${zettel.id}`,
      score: 0.9,
    })),
    ...vault.media.map((item) => ({
      type: "media" as const,
      id: item.id,
      title: item.title,
      snippet: `${item.creator} · ${item.review}`,
      href: `/vault?detail=media:${item.id}`,
      score: 0.82,
    })),
    ...vault.places.map((place) => ({
      type: "place" as const,
      id: place.id,
      title: place.name,
      snippet: `${place.address} · ${place.review}`,
      href: `/vault?detail=place:${place.id}`,
      score: 0.78,
    })),
  ];

  const results = rawItems
    .filter((item) => {
      if (!normalized) return true;
      return `${item.title} ${item.snippet}`.toLowerCase().includes(normalized);
    })
    .filter((item) => {
    if (!types?.length) return true;
    return types.includes(item.type);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return NextResponse.json({
    results,
    elapsedMs: Date.now() - startedAt,
  });
}
