import { createHash } from "node:crypto";

import { analysisMarkdown, notionDateToIso, type NotionExport, type NotionPage } from "./notion-export";

/**
 * The owner-approved transmission scope (2026-10-17). Only these databases and
 * counts may be analyzed; relation values are never sent to the provider.
 * Changing a database or a count needs a new approval and a new scope file.
 */
export const APPROVED_SCOPE = Object.freeze({
  contract: "notion-loop-scope-v1",
  approvedAt: "2026-10-17",
  approval: "Owner chat 2026-10-17: standard 60 (영상 15·컨텐츠 15·게임 12·지식 창고 12·묵상 6), smoke 15; diary/network/contacts/work/career/gift/project/life-log excluded; relation values kept local as imported links.",
  provider: "openai-plan-only",
  standard: { "영상 로그": 15, "컨텐츠 로그": 15, "게임 로그": 12, "1 지식 창고": 12, "묵상": 6 } as Readonly<Record<string, number>>,
  smoke: { "영상 로그": 5, "컨텐츠 로그": 2, "게임 로그": 4, "1 지식 창고": 4 } as Readonly<Record<string, number>>,
});

/** Notion databases become the owner's imported types (stable keys, original labels). */
export const DATABASE_TYPES: Readonly<Record<string, Readonly<{ key: string; label: string }>>> = {
  "영상 로그": { key: "notion.video_log", label: "영상 로그" },
  "컨텐츠 로그": { key: "notion.content_log", label: "컨텐츠 로그" },
  "게임 로그": { key: "notion.game_log", label: "게임 로그" },
  "1 지식 창고": { key: "notion.knowledge", label: "지식 창고" },
  "묵상": { key: "notion.meditation", label: "묵상" },
};
/** Pages of these databases are people: they become person entities by name only. */
export const PERSON_DATABASES = new Set(["3 네트워크"]);

const PROPERTY_SLUGS: Readonly<Record<string, string>> = {
  "컨텐츠 로그": "content_log", "게임 로그": "game_log", "영상 로그": "video_log", "도서 로그": "book_log",
  "3. 네트워크": "network", "관련인물": "related_person", "관련 인물": "related_person", "사람": "person",
  "라이프 로그": "life_log", "2. 프로젝트": "project", "1. 지식 창고": "knowledge", "묵상 로그": "meditation",
  "묵상": "meditation", "일기": "diary", "운동 로그": "workout", "배경지식": "background",
};

export function relationPredicate(property: string) {
  const slug = PROPERTY_SLUGS[property] ?? `p${createHash("sha256").update(property).digest("hex").slice(0, 8)}`;
  return { key: `notion.link.${slug}`, label: property };
}

export type ScopeEntry = Readonly<{ pageId: string; database: string }>;
export type NotionLoopScope = Readonly<{
  contract: string; approvedAt: string; approval: string; provider: string; sourceSha256: string;
  sets: Readonly<{ smoke: readonly ScopeEntry[]; standard: readonly ScopeEntry[] }>;
}>;

const rank = (pageId: string) => createHash("sha256").update(`notion-loop-v1:${pageId}`).digest("hex");
const byRank = (pages: readonly NotionPage[]) => [...pages].sort((left, right) => rank(left.pageId).localeCompare(rank(right.pageId)));

export function capturedAt(page: NotionPage, importDay: string): string {
  const dated = page.properties.find((property) => property.name === "날짜" || property.name === "생성 일시");
  return (dated && notionDateToIso(dated.value)) ?? importDay;
}

function parentContentIds(page: NotionPage, exported: NotionExport) {
  return page.properties.filter((property) => property.name === "컨텐츠 로그")
    .flatMap((property) => property.links.map((link) => link.pageId))
    .filter((id) => exported.pages.get(id)?.database === "컨텐츠 로그");
}

/**
 * Deterministic sample: dated video logs on distinct days (template formation),
 * content-log parents of the sampled video/game logs (links resolve inside the
 * sample), knowledge notes spread over three length bands.
 */
export function selectScope(exported: NotionExport): NotionLoopScope {
  const of = (database: string) => byRank([...exported.pages.values()].filter((page) => page.database === database && analysisMarkdown(page).trim()));
  const quota = APPROVED_SCOPE.standard;
  const days = new Set<string>();
  const videos = of("영상 로그").filter((page) => {
    const day = capturedAt(page, "").slice(0, 10);
    if (!day || days.has(day)) return false;
    days.add(day);
    return true;
  }).slice(0, quota["영상 로그"]);
  const games = of("게임 로그").slice(0, quota["게임 로그"]);
  const contents: NotionPage[] = [];
  const addParent = (page: NotionPage, cap: number) => {
    const parent = parentContentIds(page, exported).find((id) => !contents.some((item) => item.pageId === id));
    if (parent && contents.length < cap) contents.push(exported.pages.get(parent)!);
  };
  for (const video of videos) addParent(video, 8);
  for (const game of games) addParent(game, quota["컨텐츠 로그"]!);
  for (const page of of("컨텐츠 로그")) if (contents.length < quota["컨텐츠 로그"]! && !contents.includes(page)) contents.push(page);
  const notes = [...of("1 지식 창고")].sort((left, right) => left.body.length - right.body.length);
  const bandSize = Math.ceil(notes.length / 3);
  const knowledge = [0, 1, 2].flatMap((band) => byRank(notes.slice(band * bandSize, (band + 1) * bandSize)).slice(0, quota["1 지식 창고"]! / 3));
  const meditations = of("묵상").slice(0, quota["묵상"]);

  const entry = (page: NotionPage): ScopeEntry => ({ pageId: page.pageId, database: page.database! });
  const standard = [...videos, ...contents, ...games, ...knowledge, ...meditations].map(entry);
  const smokeVideos = videos.filter((video) => parentContentIds(video, exported).some((id) => contents.some((item) => item.pageId === id)));
  const smokeContents = smokeVideos.slice(0, APPROVED_SCOPE.smoke["컨텐츠 로그"]).map((video) => contents.find((item) => parentContentIds(video, exported).includes(item.pageId))!);
  const smoke = [
    ...[...smokeVideos, ...videos.filter((video) => !smokeVideos.includes(video))].slice(0, APPROVED_SCOPE.smoke["영상 로그"]),
    ...smokeContents,
    ...games.slice(0, APPROVED_SCOPE.smoke["게임 로그"]),
    ...[0, 1, 2, 0].map((band, index) => byRank(notes.slice(band * bandSize, (band + 1) * bandSize))[index === 3 ? 1 : 0]!).filter(Boolean),
  ].map(entry);
  return {
    contract: APPROVED_SCOPE.contract, approvedAt: APPROVED_SCOPE.approvedAt, approval: APPROVED_SCOPE.approval, provider: APPROVED_SCOPE.provider,
    sourceSha256: exported.sha256, sets: { smoke, standard },
  };
}

/** Refuse anything outside the approved databases and counts. */
export function assertScope(scope: NotionLoopScope, exported: NotionExport) {
  if (scope.contract !== APPROVED_SCOPE.contract || scope.sourceSha256 !== exported.sha256) throw new Error("scope_source_mismatch");
  for (const [name, entries] of Object.entries(scope.sets) as [keyof typeof scope.sets, readonly ScopeEntry[]][]) {
    const limits = name === "smoke" ? APPROVED_SCOPE.smoke : APPROVED_SCOPE.standard;
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const page = exported.pages.get(entry.pageId);
      if (!page || page.database !== entry.database || !(entry.database in limits)) throw new Error("scope_entry_not_approved");
      counts.set(entry.database, (counts.get(entry.database) ?? 0) + 1);
    }
    for (const [database, count] of counts) if (count > limits[database]!) throw new Error("scope_count_exceeded");
    if (new Set(entries.map((entry) => entry.pageId)).size !== entries.length) throw new Error("scope_duplicate_entry");
  }
  if (!scope.sets.smoke.every((entry) => scope.sets.standard.some((item) => item.pageId === entry.pageId))) throw new Error("scope_smoke_not_subset");
}
