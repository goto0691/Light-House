import type { LucideIcon } from "lucide-react";
import { Compass, Gem, HeartHandshake, ListTodo, Sparkles } from "lucide-react";

import { KeyHint } from "@/components/shared/key-hint";
import { cn } from "@/lib/utils/cn";

type EmptyStateProps = {
  icon?: LucideIcon | string;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void; hotkey?: string };
  illustration?: "zettel" | "person" | "task" | "habit" | "generic";
  className?: string;
};

export function EmptyState({ icon, title, description, cta, illustration = "generic", className }: EmptyStateProps) {
  const Icon = typeof icon === "string" || !icon ? Compass : icon;
  const illustrationIconMap = {
    zettel: Gem,
    person: HeartHandshake,
    task: ListTodo,
    habit: Sparkles,
    generic: Compass,
  } satisfies Record<NonNullable<EmptyStateProps["illustration"]>, LucideIcon>;
  const Illustration =
    typeof icon === "string" || icon
      ? null
      : illustrationIconMap[illustration];

  return (
    <div className={cn("glass flex min-h-[240px] flex-col items-center justify-center rounded-[32px] px-6 py-10 text-center", className)}>
      {typeof icon === "string" ? (
        <div className="float-illustration mb-4 text-3xl">{icon}</div>
      ) : (
        <div className="float-illustration mb-5 rounded-full border border-primary/15 bg-primary/10 p-4 text-primary shadow-[var(--shadow-glow)]">
          {Illustration ? <Illustration className="h-7 w-7" /> : <Icon className="h-6 w-6" />}
        </div>
      )}
      <h3 className="text-balance font-display text-3xl text-foreground">{title}</h3>
      {description ? <p className="text-pretty mt-3 max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {cta ? (
        <button
          className="focus-ring mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary transition [@media(hover:hover)]:hover:bg-primary/15"
          onClick={cta.onClick}
          type="button"
        >
          <span>{cta.label}</span>
          {cta.hotkey ? <KeyHint keys={cta.hotkey} /> : null}
        </button>
      ) : null}
    </div>
  );
}
