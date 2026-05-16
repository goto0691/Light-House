"use client";

import { cn } from "@/lib/utils/cn";

type MoodButtonGroupProps = {
  value: number;
  options: string[];
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function MoodButtonGroup({ value, options, onChange, disabled }: MoodButtonGroupProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((mood, index) => (
        <button
          className={cn("rounded-md border px-3 py-2 text-xl", index + 1 === value ? "border-primary bg-primary/15" : "border-white/10 bg-white/5 hover:bg-white/8", disabled && "opacity-60")}
          disabled={disabled}
          key={mood}
          onClick={() => onChange(index + 1)}
          type="button"
        >
          {mood}
        </button>
      ))}
    </div>
  );
}
