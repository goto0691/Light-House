import type { ZettelMock } from "@/lib/mock/vault";

export type ZettelPageMergeMode = "append" | "replace";

export function mergeZettelList(items: ZettelMock[], zettel?: ZettelMock | null) {
  if (!zettel) return items;
  const exists = items.some((item) => item.id === zettel.id);
  if (!exists) return [zettel, ...items];
  return items.map((item) => (item.id === zettel.id ? { ...item, ...zettel } : item));
}

export function mergeZettelListItems(items: ZettelMock[], zettels: ZettelMock[]) {
  return zettels.reduce((current, zettel) => mergeZettelList(current, zettel), items);
}

export function mergePagedZettelPage(
  current: ZettelMock[],
  page: ZettelMock[],
  {
    loadedDetailIds,
    mode,
  }: {
    loadedDetailIds?: Iterable<string>;
    mode: ZettelPageMergeMode;
  },
) {
  const withPage = mergeZettelListItems(mode === "append" ? current : [], page);
  if (mode === "append") return withPage;

  const detailIds = new Set(loadedDetailIds ?? []);
  const loadedDetails = current.filter((item) => detailIds.has(item.id));
  return mergeZettelListItems(withPage, loadedDetails);
}

export function removeZettelFromList(items: ZettelMock[], zettelId: string) {
  return items.filter((item) => item.id !== zettelId);
}
