import { PRMClient } from "@/components/prm/prm-client";
import { getPRMHydrationSnapshot } from "@/lib/server/prm";
import { listSavedViews } from "@/lib/server/ui-state";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function prmPathFromSearchParams(searchParams: Awaited<SearchParams>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `/prm?${query}` : "/prm";
}

export default async function PrmPage({ searchParams }: { searchParams: SearchParams }) {
  const prmPath = prmPathFromSearchParams(await searchParams);
  const [savedViews, initialSnapshot] = await Promise.all([
    listSavedViews({ domain: "people", scope: "relationships" }),
    getPRMHydrationSnapshot(prmPath),
  ]);

  return <PRMClient initialSnapshotJson={JSON.stringify(initialSnapshot)} savedViews={savedViews} />;
}
