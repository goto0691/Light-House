"use client";

import { KeyHint } from "@/components/shared/key-hint";

export type ShortcutBinding = {
  id: string;
  category: string;
  actionKey: string;
  label: string;
  binding: string;
  isEnabled: boolean;
  isCustom: boolean;
  displayOrder: number;
};

type ShortcutTableProps = {
  bindings: ShortcutBinding[];
  onChange: (bindings: ShortcutBinding[]) => void;
};

export function ShortcutTable({ bindings, onChange }: ShortcutTableProps) {
  const grouped = new Map<string, ShortcutBinding[]>();
  for (const binding of bindings) {
    const next = grouped.get(binding.category) ?? [];
    next.push(binding);
    grouped.set(binding.category, next.sort((left, right) => left.displayOrder - right.displayOrder));
  }

  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5" key={category}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.24em] text-primary">{category}</p>
            <span className="text-xs text-muted-foreground">{items.length} bindings</span>
          </div>

          <div className="mt-4 space-y-3">
            {items.map((item) => (
              <div className="grid gap-3 rounded-3xl border border-white/10 bg-black/10 p-4 md:grid-cols-[1.1fr_0.9fr_auto]" key={item.id}>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.actionKey}</span>
                    {item.isCustom ? <span className="rounded-full border border-white/10 px-2 py-1">custom</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground outline-none"
                    onChange={(event) =>
                      onChange(bindings.map((entry) => (entry.id === item.id ? { ...entry, binding: event.target.value } : entry)))
                    }
                    value={item.binding}
                  />
                  <KeyHint keys={item.binding} />
                </div>
                <button
                  className={`rounded-2xl border px-3 py-2 text-xs transition ${
                    item.isEnabled ? "border-primary bg-primary/15 text-foreground" : "border-white/10 bg-transparent text-muted-foreground"
                  }`}
                  onClick={() =>
                    onChange(bindings.map((entry) => (entry.id === item.id ? { ...entry, isEnabled: !entry.isEnabled } : entry)))
                  }
                  type="button"
                >
                  {item.isEnabled ? "활성" : "비활성"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
