import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils/cn";

interface GlassCardProps extends PropsWithChildren {
  className?: string;
  elevated?: boolean;
}

export function GlassCard({ children, className, elevated = false }: GlassCardProps) {
  return <section className={cn(elevated ? "glass-elevated" : "glass", "rounded-[20px] p-5", className)}>{children}</section>;
}
