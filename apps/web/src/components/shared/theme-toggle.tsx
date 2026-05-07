"use client";

import { Moon, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  return (
    <button
      aria-label="Toggle theme"
      className="rounded-2xl border border-white/10 bg-white/5 p-2 text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
      onClick={() => setTheme(isLight ? "dark" : "light")}
      type="button"
    >
      {isLight ? <Moon className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
    </button>
  );
}
