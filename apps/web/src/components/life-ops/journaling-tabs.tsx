"use client";

import { useState } from "react";

import { GlassCard } from "@/components/shared/glass-card";
import { ZenEditor } from "@/components/shared/zen-editor";
import { cn } from "@/lib/utils/cn";

type TabKey = "journal" | "meditation" | "gratitude";

type JournalingTabsProps = {
  journal: string;
  meditation: string;
  gratitude: string;
  meditationVerse: string;
  onJournalChange: (value: string) => void;
  onMeditationChange: (value: string) => void;
  onGratitudeChange: (value: string) => void;
  onSave: (field: TabKey, value: string) => void;
  disabled?: boolean;
};

export function JournalingTabs({ journal, meditation, gratitude, meditationVerse, onJournalChange, onMeditationChange, onGratitudeChange, onSave, disabled }: JournalingTabsProps) {
  const [tab, setTab] = useState<TabKey>("journal");
  const value = tab === "journal" ? journal : tab === "meditation" ? meditation : gratitude;
  const onChange = tab === "journal" ? onJournalChange : tab === "meditation" ? onMeditationChange : onGratitudeChange;
  const saveLabel = tab === "journal" ? "일기 저장" : tab === "meditation" ? "묵상 저장" : "감사 저장";

  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <div className="flex flex-wrap gap-2">
          {([
            ["journal", "일기"],
            ["meditation", "묵상"],
            ["gratitude", "감사"],
          ] as const).map(([key, label]) => (
            <button
              aria-pressed={tab === key}
              className={cn("rounded-md px-3 py-2 text-xs", tab === key ? "bg-primary/15 text-primary" : "bg-white/6 text-muted-foreground hover:bg-white/8 hover:text-foreground")}
              key={key}
              onClick={() => setTab(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "meditation" ? <p className="mt-4 text-sm text-muted-foreground">본문 말씀: <span className="text-foreground">{meditationVerse}</span></p> : null}
      </GlassCard>
      <ZenEditor onChange={onChange} value={value} />
      <button className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground" disabled={disabled} onClick={() => onSave(tab, value)} type="button">
        {saveLabel}
      </button>
    </div>
  );
}
