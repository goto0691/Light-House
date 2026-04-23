import { cn } from "@/lib/utils/cn";

type KeyHintProps = {
  keys: string;
  className?: string;
};

export function KeyHint({ keys, className }: KeyHintProps) {
  return (
    <kbd
      className={cn(
        "inline-flex min-h-6 items-center rounded-xl border border-white/10 bg-black/20 px-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      {keys}
    </kbd>
  );
}

