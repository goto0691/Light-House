"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AppearanceControls } from "@/components/settings/appearance-controls";
import { BentoLayoutEditor, type LayoutWidget } from "@/components/settings/bento-layout-editor";

type AppearanceSettingsClientProps = {
  initial: {
    theme: "dark" | "light" | "system";
    glassOpacity: "full" | "low" | "off";
    dashboardLayouts: LayoutWidget[];
  };
};

export function AppearanceSettingsClient({ initial }: AppearanceSettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [theme, setTheme] = useState(initial.theme);
  const [glassOpacity, setGlassOpacity] = useState(initial.glassOpacity);
  const [layouts, setLayouts] = useState(initial.dashboardLayouts);

  return (
    <div className="mt-8 space-y-4">
      <AppearanceControls glassOpacity={glassOpacity} onGlassOpacityChange={setGlassOpacity} onThemeChange={setTheme} theme={theme} />
      <BentoLayoutEditor items={layouts} onChange={setLayouts} />

      <button
        className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            try {
              const response = await fetch("/api/settings/appearance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  theme,
                  glassOpacity,
                  dashboardLayouts: layouts.map(({ widgetKey, titleOverride, layout, isHidden, displayOrder }) => ({
                    widgetKey,
                    titleOverride,
                    layout,
                    isHidden,
                    displayOrder,
                  })),
                }),
              });

              const payload = (await response.json()) as { error?: string };
              if (!response.ok) {
                throw new Error(payload.error ?? "외형 설정 저장에 실패했습니다.");
              }

              document.documentElement.setAttribute("data-glass-opacity", glassOpacity);
              toast.success("외형 설정을 저장했습니다.");
            } catch (error) {
              toast.error("외형 설정 저장에 실패했습니다.", {
                description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
              });
            }
          });
        }}
        type="button"
      >
        외형 설정 저장
      </button>
    </div>
  );
}
