"use client";

type AppearanceControlsProps = {
  theme: "dark" | "light" | "system";
  glassOpacity: "full" | "low" | "off";
  onThemeChange: (value: "dark" | "light" | "system") => void;
  onGlassOpacityChange: (value: "full" | "low" | "off") => void;
};

const THEME_OPTIONS = [
  { value: "system", label: "시스템" },
  { value: "dark", label: "다크" },
  { value: "light", label: "라이트" },
] as const;

const GLASS_OPTIONS = [
  { value: "full", label: "높음" },
  { value: "low", label: "낮음" },
  { value: "off", label: "끔" },
] as const;

export function AppearanceControls({ theme, glassOpacity, onThemeChange, onGlassOpacityChange }: AppearanceControlsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-white/5 p-5">
        <p className="text-xs tracking-[0.08em] text-primary">테마</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => (
            <button
              className={`rounded-md border px-3 py-3 text-sm ${
                theme === option.value ? "border-primary bg-primary/15 text-foreground" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8"
              }`}
              key={option.value}
              onClick={() => onThemeChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-5">
        <p className="text-xs tracking-[0.08em] text-primary">유리 투명도</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {GLASS_OPTIONS.map((option) => (
            <button
              className={`rounded-md border px-3 py-3 text-sm ${
                glassOpacity === option.value ? "border-primary bg-primary/15 text-foreground" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8"
              }`}
              key={option.value}
              onClick={() => onGlassOpacityChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
