"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { buildDailyLogPropertyForm, dailyLogPropertyPayload, type DailyLogPropertyForm } from "@/components/life-ops/daily-log-property-form";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { SourcePropertyInspector, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { DailyLogMock } from "@/lib/mock/life-ops";
import { DAILY_PROPERTY_DEFINITIONS, DAILY_PROPERTY_GROUPS } from "@/lib/properties/daily";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useLifeOpsStore } from "@/stores/use-life-ops-store";

type DailyLogPropertiesPanelProps = {
  log: DailyLogMock;
};

const DAILY_PANEL_DEFINITIONS = DAILY_PROPERTY_DEFINITIONS.filter((definition) => definition.field !== "date");

const DAILY_SOURCE_TARGETS: Array<SourcePropertyTarget<DailyLogPropertyForm>> = [
  { value: "skip", label: "건너뛰기" },
  { value: "mood", label: "기분", apply: ({ value }) => ({ mood: numberSourceValue(value, "3") }) },
  { value: "energy", label: "에너지", apply: ({ value }) => ({ energy: numberSourceValue(value, "3") }) },
  { value: "emotions", label: "감정", apply: ({ form, value }) => ({ emotions: uniqueValues([...form.emotions, ...splitSourceValues(value)]) }) },
  { value: "sleepHours", label: "수면 시간", apply: ({ value }) => ({ sleepHours: numberSourceValue(value, "0") }) },
  { value: "deepWorkMinutes", label: "딥워크", apply: ({ value }) => ({ deepWorkMinutes: numberSourceValue(value, "0") }) },
  { value: "gratitude", label: "감사", apply: ({ value }) => ({ gratitude: value }) },
  { value: "journal", label: "일기", apply: ({ value }) => ({ journal: value }) },
  { value: "meditation", label: "묵상", apply: ({ value }) => ({ meditation: value }) },
  { value: "meditationVerse", label: "본문 말씀", apply: ({ value }) => ({ meditationVerse: value }) },
];

const DAILY_FIELD_OPTIONS = { emotions: { chipPrefix: "#", stripHash: true } };

export function DailyLogPropertiesPanel({ log }: DailyLogPropertiesPanelProps) {
  const [isPending, startTransition] = useTransition();
  const activeLog = useLifeOpsStore((state) => state.logs[log.date]) ?? log;
  const replaceSnapshot = useLifeOpsStore((state) => state.replaceSnapshot);
  const [form, setForm] = useState<DailyLogPropertyForm>(() => buildDailyLogPropertyForm(activeLog));
  const [isDirty, setIsDirty] = useState(false);
  const [syncedDate, setSyncedDate] = useState(activeLog.date);

  useEffect(() => {
    if (isDirty && activeLog.date === syncedDate) return;
    setForm(buildDailyLogPropertyForm(activeLog));
    setSyncedDate(activeLog.date);
    setIsDirty(false);
  }, [activeLog, isDirty, syncedDate]);

  const updateForm = (patch: Partial<DailyLogPropertyForm>) => {
    setIsDirty(true);
    setForm((current) => ({ ...current, ...patch }));
  };

  const saveProperties = () => {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/life-ops/logs/${activeLog.date}/properties`,
          dailyLogPropertyPayload(form),
          replaceSnapshot,
        );
        setIsDirty(false);
        toast.success("일일 속성을 저장했습니다.");
      } catch (error) {
        toast.error("일일 속성 저장에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">일일 속성</p>
            <p className="mt-1 text-sm text-muted-foreground">기분, 에너지, 생활 데이터, 저널 필드를 한 번에 조정합니다.</p>
          </div>
          <button className="focus-ring rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={isPending} onClick={saveProperties} type="button">
            {isPending ? "저장 중..." : "속성 저장"}
          </button>
        </div>
      </section>
      <PropertyPanel
        definitions={DAILY_PANEL_DEFINITIONS}
        fieldOptions={DAILY_FIELD_OPTIONS}
        form={form}
        groups={DAILY_PROPERTY_GROUPS}
        onChange={updateForm}
      />
      <SourcePropertyInspector
        definitions={DAILY_PANEL_DEFINITIONS}
        form={form}
        onChange={updateForm}
        sourceDocument={activeLog.sourceDocument}
        targets={DAILY_SOURCE_TARGETS}
        title="일일 원본 속성"
      />
    </div>
  );
}

function splitSourceValues(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function uniqueValues(values: string[]) {
  return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()].slice(0, 12);
}

function numberSourceValue(value: string, fallback: string) {
  const match = value.match(/\d+(?:\.\d+)?/);
  return match?.[0] ?? fallback;
}
