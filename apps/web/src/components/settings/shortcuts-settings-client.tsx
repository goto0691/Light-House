"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ShortcutTable, type ShortcutBinding } from "@/components/settings/shortcut-table";

type ShortcutsSettingsClientProps = {
  initial: {
    bindings: ShortcutBinding[];
  };
};

export function ShortcutsSettingsClient({ initial }: ShortcutsSettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [bindings, setBindings] = useState(initial.bindings);

  return (
    <div className="mt-8 space-y-4">
      <ShortcutTable bindings={bindings} onChange={setBindings} />

      <button
        className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            try {
              const response = await fetch("/api/settings/shortcuts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  bindings: bindings.map(({ category, actionKey, label, binding, isEnabled, isCustom, displayOrder }) => ({
                    category,
                    actionKey,
                    label,
                    binding,
                    isEnabled,
                    isCustom,
                    displayOrder,
                  })),
                }),
              });

              const payload = (await response.json()) as { error?: string };
              if (!response.ok) {
                throw new Error(payload.error ?? "단축키 저장에 실패했습니다.");
              }

              toast.success("단축키 설정을 저장했습니다.");
            } catch (error) {
              toast.error("단축키 저장에 실패했습니다.", {
                description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
              });
            }
          });
        }}
        type="button"
      >
        단축키 저장
      </button>
    </div>
  );
}
