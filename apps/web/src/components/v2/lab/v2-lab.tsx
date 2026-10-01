"use client";

import { MonitorCog, Moon, Sun } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { CaptureFixture } from "@/components/v2/lab/capture-fixture";
import { AdaptiveRecordFixture } from "@/components/v2/lab/adaptive-record-fixture";
import { LibraryFixture } from "@/components/v2/lab/library-fixture";
import { initialLabRecord, type LabRecord } from "@/components/v2/lab/lab-fixtures";
import { RecordFixture } from "@/components/v2/lab/record-fixture";
import { SearchFixture } from "@/components/v2/lab/search-fixture";
import { TemplateCaptureFixture } from "@/components/v2/lab/template-capture-fixture";
import { ExploreFixture } from "@/components/v2/lab/explore-fixture";
import { PortabilityFixture } from "@/components/v2/lab/portability-fixture";
import { PwaRegistration } from "@/components/v2/pwa-registration";
import type { V2PublicFeatureFlags } from "@/lib/v2/config/feature-flags";

const EditorFixture = dynamic(
  () => import("@/components/v2/editor/editor-fixture").then((module) => module.EditorFixture),
  { loading: () => <p className="v2-lab-loading">집필 편집기를 불러오는 중…</p>, ssr: false },
);

export type LabSurface = "library" | "record" | "adaptive" | "search" | "explore" | "template" | "portability" | "capture" | "editor";

const surfaceLabels: Array<{ key: LabSurface; label: string }> = [
  { key: "library", label: "보관함 + 미리보기" },
  { key: "record", label: "기록 + 근거" },
  { key: "adaptive", label: "AI 정리 + 검토" },
  { key: "search", label: "검색 + 내 목록" },
  { key: "explore", label: "탐색 + 다시 보기" },
  { key: "template", label: "템플릿 Capture" },
  { key: "portability", label: "이동 + 복원" },
  { key: "capture", label: "모바일 Capture" },
  { key: "editor", label: "집필 편집기" },
];

export function V2Lab({
  flags,
  initialDraftId,
  initialSurface = "library",
}: {
  flags: V2PublicFeatureFlags;
  initialDraftId?: string;
  initialSurface?: LabSurface;
}) {
  const [surface, setSurface] = useState<LabSurface>(initialSurface);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [selectedRecord, setSelectedRecord] = useState<LabRecord>(initialLabRecord);

  function openRecord(record: LabRecord) {
    setSelectedRecord(record);
    setSurface("record");
  }

  return (
    <div className="v2-lab" data-lab-theme={theme}>
      <PwaRegistration enabled={flags.offline} />
      <header className="v2-labbar">
        <div className="v2-labbar__identity">
          <MonitorCog aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>V2 구현 실험실</span>
          <span className="v2-labbar__status">fixture only</span>
        </div>
        <nav aria-label="구현 화면 선택" className="v2-labbar__tabs">
          {surfaceLabels.map((item) => (
            <button
              aria-current={surface === item.key ? "page" : undefined}
              className="v2-labbar__tab"
              key={item.key}
              onClick={() => setSurface(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="v2-labbar__actions">
          <span className="v2-labbar__flag">offline {flags.offline ? "on" : "off"}</span>
          <button
            aria-label={theme === "light" ? "어두운 테마로 보기" : "밝은 테마로 보기"}
            className="v2-labbar__theme"
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            type="button"
          >
            {theme === "light" ? <Moon aria-hidden="true" size={16} /> : <Sun aria-hidden="true" size={16} />}
          </button>
        </div>
      </header>

      <main className="v2-lab__stage">
        {surface === "library" ? (
          <LibraryFixture onOpenRecord={openRecord} selectedRecord={selectedRecord} setSelectedRecord={setSelectedRecord} />
        ) : null}
        {surface === "record" ? <RecordFixture onBack={() => setSurface("library")} record={selectedRecord} /> : null}
        {surface === "adaptive" ? <AdaptiveRecordFixture /> : null}
        {surface === "search" ? <SearchFixture /> : null}
        {surface === "explore" ? <ExploreFixture /> : null}
        {surface === "template" ? <TemplateCaptureFixture /> : null}
        {surface === "portability" ? <PortabilityFixture /> : null}
        {surface === "capture" ? <CaptureFixture initialDraftId={initialDraftId} offlineEnabled={flags.offline} /> : null}
        {surface === "editor" ? <EditorFixture /> : null}
      </main>
    </div>
  );
}
