import { NextResponse } from "next/server";

import type { SearchItem } from "@/lib/mock/search";
import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";
import { searchWithFTS, seedSearchIndexes } from "@/lib/server/search";
import { seedSemanticZettelIndex, semanticSearchZettels } from "@/lib/server/vectorize";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

function filterByTypes<T extends SearchItem>(items: T[], types?: string[]) {
  if (!types?.length) return items;
  return items.filter((item) => types.includes(item.type));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const types = searchParams
    .get("types")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const semantic = searchParams.get("semantic") === "1" && process.env.NEXT_PUBLIC_FLAG_SEMANTIC_SEARCH !== "0";

  const startedAt = Date.now();

  await Promise.all([seedActionHubSupportData(), seedPRMSupportData(), seedVaultSupportData(), seedSearchIndexes()]);

  const normalized = q.trim();
  if (normalized) {
    let semanticResults: SearchItem[] = [];
    if (semantic && (!types?.length || types.includes("zettel"))) {
      try {
        await seedSemanticZettelIndex();
        semanticResults = await semanticSearchZettels(normalized, 8);
      } catch {
        semanticResults = [];
      }
    }

    const ftsResults = await searchWithFTS(normalized, types);
    if (ftsResults) {
      const merged = [...semanticResults, ...ftsResults]
        .filter((item, index, array) => array.findIndex((candidate) => candidate.type === item.type && candidate.id === item.id) === index)
        .sort((left, right) => right.score - left.score)
        .slice(0, 20);
      return NextResponse.json({
        results: merged,
        elapsedMs: Date.now() - startedAt,
        semantic,
      });
    }
  }

  const [actionHub, prm, vault] = await Promise.all([getActionHubSnapshot(), getPRMSnapshot(), getVaultSnapshot()]);
  const lowered = normalized.toLowerCase();

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
      href: `/vault/zettels?detail=zettel:${zettel.id}`,
      score: 0.9,
    })),
    ...vault.media.map((item) => ({
      type: "media" as const,
      id: item.id,
      title: item.title,
      snippet: `${item.creator} · ${item.review}`,
      href: `/vault/media?detail=media:${item.id}`,
      score: 0.82,
    })),
    ...vault.places.map((place) => ({
      type: "place" as const,
      id: place.id,
      title: place.name,
      snippet: `${place.address} · ${place.review}`,
      href: `/vault/places?detail=place:${place.id}`,
      score: 0.78,
    })),
    {
      type: "tag" as const,
      id: "tag-existentialism",
      title: "실존주의",
      snippet: "#existentialism · 핵심 지식 태그",
      href: "/vault?tag=existentialism",
      score: 0.74,
    },
    {
      type: "tag" as const,
      id: "tag-business",
      title: "비즈니스",
      snippet: "#business · 프로젝트/운영 태그",
      href: "/vault?tag=business",
      score: 0.72,
    },
  ];

  const results = filterByTypes(rawItems, types)
    .filter((item) => {
      if (!lowered) return true;
      return `${item.title} ${item.snippet}`.toLowerCase().includes(lowered);
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);

  return NextResponse.json({
    results,
    elapsedMs: Date.now() - startedAt,
    semantic,
  });
}
