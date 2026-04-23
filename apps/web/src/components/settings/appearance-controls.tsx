"use client";

type AppearanceControlsProps = {
  theme: "dark" | "light" | "system";
  glassOpacity: "full" | "low" | "off";
  onThemeChange: (value: "dark" | "light" | "system") => void;
  onGlassOpacityChange: (value: "full" | "low" | "off") => void;
};

export function AppearanceControls({ theme, glassOpacity, onThemeChange, onGlassOpacityChange }: AppearanceControlsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Theme</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(["system", "dark", "light"] as const).map((option) => (
            <button
              className={`rounded-2xl border px-3 py-3 text-sm transition ${
                theme === option ? "border-primary bg-primary/15 text-foreground" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8"
              }`}
              key={option}
              onClick={() => onThemeChange(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Glass Opacity</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(["full", "low", "off"] as const).map((option) => (
            <button
              className={`rounded-2xl border px-3 py-3 text-sm transition ${
                glassOpacity === option ? "border-primary bg-primary/15 text-foreground" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8"
              }`}
              key={option}
              onClick={() => onGlassOpacityChange(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
