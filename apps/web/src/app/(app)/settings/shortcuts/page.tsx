import { GlassCard } from "@/components/shared/glass-card";

const SHORTCUTS = [
  ["Cmd+K", "Command Palette"],
  ["Cmd+Shift+N", "Quick Capture"],
  ["Cmd+\\", "LNB Toggle"],
  ["?", "Hotkey Cheat Sheet"],
  ["g d / a / v / p / l / s", "Domain Navigation"],
];

export default function ShortcutsPage() {
  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Shortcuts</p>
      <h1 className="mt-3 text-3xl font-semibold">단축키</h1>
      <div className="mt-5 space-y-3">
        {SHORTCUTS.map(([combo, description]) => (
          <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-4 py-3" key={combo}>
            <p className="text-sm text-foreground">{description}</p>
            <code className="rounded-xl bg-black/20 px-2 py-1 text-xs text-primary">{combo}</code>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
