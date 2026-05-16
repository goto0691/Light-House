import { NextResponse } from "next/server";

import type { SearchItem } from "@/lib/mock/search";
import { seedActionHubSupportData } from "@/lib/server/action-hub";
import { seedPRMSupportData } from "@/lib/server/prm";
import { getSearchReadModelItems, searchWithFTS, seedSearchIndexes } from "@/lib/server/search";
import { seedSemanticZettelIndex, semanticSearchZettels } from "@/lib/server/vectorize";
import { seedVaultSupportData } from "@/lib/server/vault";

function supplementalReadModelTypes(types?: string[]) {
  if (types?.length && !types.includes("place")) return [];
  return ["place"];
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
      const supplementalTypes = supplementalReadModelTypes(types);
      const supplementalResults = ftsResults.length
        ? supplementalTypes.length
          ? await getSearchReadModelItems(normalized, supplementalTypes)
          : []
        : await getSearchReadModelItems(normalized, types);
      const merged = [...semanticResults, ...ftsResults, ...supplementalResults]
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

  const results = await getSearchReadModelItems(normalized, types);

  return NextResponse.json({
    results,
    elapsedMs: Date.now() - startedAt,
    semantic,
  });
}
