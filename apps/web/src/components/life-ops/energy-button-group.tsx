"use client";

import { cn } from "@/lib/utils/cn";

type EnergyButtonGroupProps = {
  value: number;
  options: string[];
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function EnergyButtonGroup({ value, options, onChange, disabled }: EnergyButtonGroupProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((energy, index) => (
        <button
          className={cn(
            "rounded-md px-3 py-1 text-xs",
            index + 1 === value ? "bg-primary/20 text-primary" : "bg-white/6 text-muted-foreground hover:bg-white/8 hover:text-foreground",
            disabled && "opacity-60",
          )}
          disabled={disabled}
          key={energy}
          onClick={() => onChange(index + 1)}
          type="button"
        >
          {energy}
        </button>
      ))}
    </div>
  );
}
