import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils/cn";

type BentoGridProps = PropsWithChildren<{
  className?: string;
}>;

type BentoCardProps = PropsWithChildren<{
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  priority?: "hero" | "primary" | "secondary";
}>;

export function BentoGrid({ children, className }: BentoGridProps) {
  return <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-12", className)}>{children}</div>;
}

export function BentoCard({ children, className, colSpan = 12, rowSpan = 1, priority = "secondary" }: BentoCardProps) {
  return (
    <div
      className={cn(
        "min-h-[160px]",
        colSpan === 12 && "md:col-span-12",
        colSpan === 8 && "md:col-span-8",
        colSpan === 6 && "md:col-span-6",
        colSpan === 4 && "md:col-span-4",
        colSpan === 3 && "md:col-span-3",
        rowSpan === 2 && "md:min-h-[280px]",
        rowSpan === 3 && "md:min-h-[420px]",
        priority === "hero" && "md:min-h-[220px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

