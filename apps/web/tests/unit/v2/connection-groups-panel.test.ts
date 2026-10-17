import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ConnectionGroupsPanel } from "@/components/v2/connection-groups-panel";
import type { ConnectionGroups } from "@/lib/v2/infrastructure/d1/connection-groups-repository";

const item = (id: string, label: string, date: string | null, kind: "document" | "entity" = "document", origins: ("user" | "ai")[] = ["user"]) =>
  ({ objectId: id, objectKind: kind, label, date, relationLabels: ["3. 네트워크"], directions: ["incoming" as const], origins });

const groups: ConnectionGroups = {
  contractVersion: "connection-groups-v1",
  total: 9,
  summary: [{ groupKey: "type:video_log", label: "영상 로그", count: 7 }, { groupKey: "entity:person", label: "사람", count: 2 }],
  groups: [
    { groupKey: "type:video_log", label: "영상 로그", count: 7, relationLabels: ["3. 네트워크"], closedSensitiveCount: 1,
      items: [item("r1", "감상 하나", "2025-09-21T12:00:00.000Z"), item("r2", "감상 둘", "2025-09-08T12:00:00.000Z")] },
    { groupKey: "entity:person", label: "사람", count: 2, relationLabels: ["사람"], closedSensitiveCount: 0,
      items: [item("p1", "감독 갑", null, "entity"), item("p2", "AI가 본 사람", null, "entity", ["ai"])] },
  ],
  pendingCount: 3,
};
const render = (props: Parameters<typeof ConnectionGroupsPanel>[0]) => renderToStaticMarkup(createElement(ConnectionGroupsPanel, props));

test("shows a count per category, the newest items, links to records and entities, and closed sensitive counts", () => {
  const html = render({ basePath: "/v2/entities/e1", groups, heading: "이어진 기록" });
  expect(html).toContain("연결 9");
  expect(html).toContain('href="#connections-type-video_log"');
  expect(html).toContain('href="/v2/records/r1"');
  expect(html).toContain('href="/v2/entities/p1"');
  expect(html).toContain("<small>3. 네트워크</small>");
  expect(html).toContain("민감한 기록 1개는");
  expect(html).toContain("영상 로그 6개 모두 보기");
  expect(html).toContain('href="/v2/entities/e1?group=type%3Avideo_log#connections-type-video_log"');
  expect(html).toContain("AI 해석");
  expect(html).toContain("AI가 찾은 연결 3개는 아직 확인 전");
  expect(html.indexOf("감상 하나")).toBeLessThan(html.indexOf("감상 둘"));
});

test("an opened group offers search instead of another expand link, and an empty view renders nothing", () => {
  const html = render({ basePath: "/v2/entities/e1", expandedGroup: "type:video_log", groups, heading: "이어진 기록",
    searchHref: (key: string) => key === "type:video_log" ? "/v2/search?entity=e1&type=video_log" : null });
  expect(html).not.toContain("6개 모두 보기");
  expect(html).toContain('href="/v2/search?entity=e1&amp;type=video_log"');
  expect(render({ basePath: "/x", groups: { ...groups, total: 0, summary: [], groups: [], pendingCount: 0 }, heading: "h" })).toBe("");
});
