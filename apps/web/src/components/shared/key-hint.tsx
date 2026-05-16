import { cn } from "@/lib/utils/cn";

type KeyHintProps = {
  keys: string;
  className?: string;
};

export function formatKeyHint(keys: string) {
  return keys
    .replace(/\bCmd\b/g, "⌘")
    .replace(/\bCommand\b/g, "⌘")
    .replace(/\bMod\b/gi, "컨트롤/⌘")
    .replace(/\bShift\b/g, "⇧");
}

export function KeyHint({ keys, className }: KeyHintProps) {
  return (
    <kbd
      className={cn(
        "inline-flex min-h-6 items-center rounded-md border border-white/10 bg-black/20 px-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      {formatKeyHint(keys)}
    </kbd>
  );
}
