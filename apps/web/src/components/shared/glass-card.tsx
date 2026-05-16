import type { ComponentPropsWithoutRef, ElementType, PropsWithChildren } from "react";

import { cn } from "@/lib/utils/cn";

type BaseGlassCardProps = PropsWithChildren<{
  className?: string;
  elevated?: boolean;
  interactive?: boolean;
  variant?: "default" | "elevated";
  elevation?: "l0" | "l1" | "l2" | "l3";
  priority?: "hero" | "primary" | "secondary";
  as?: ElementType;
}>;

type GlassCardProps<T extends ElementType> = BaseGlassCardProps & {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof BaseGlassCardProps | "as">;

export function GlassCard<T extends ElementType = "section">({
  children,
  className,
  elevated = false,
  interactive = false,
  variant,
  elevation = "l1",
  priority = "primary",
  as,
  ...props
}: GlassCardProps<T>) {
  const resolvedVariant = variant ?? (elevated ? "elevated" : "default");
  const Component = (as ?? "section") as ElementType;

  return (
    <Component
      className={cn(
        resolvedVariant === "elevated" ? "glass-elevated" : "glass",
        elevation === "l0" && "elevation-l0",
        elevation === "l1" && "elevation-l1",
        elevation === "l2" && "elevation-l2",
        elevation === "l3" && "elevation-l3",
        priority === "hero" && "rounded-lg p-5 md:p-6",
        priority === "primary" && "rounded-lg p-5",
        priority === "secondary" && "rounded-md p-4",
        "focus-ring",
        interactive && "cursor-pointer",
        interactive && "[@media(hover:hover)]:hover:border-primary/20",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
