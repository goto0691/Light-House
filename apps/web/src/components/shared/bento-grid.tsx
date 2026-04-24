import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils/cn";

type BentoGridProps = PropsWithChildren<{
  className?: string;
  dense?: boolean;
}>;

type BentoCardProps = PropsWithChildren<{
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  priority?: "hero" | "primary" | "secondary";
}>;

export function BentoGrid({ children, className, dense = false }: BentoGridProps) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12", dense && "auto-rows-[minmax(132px,auto)]", className)}>
      {children}
    </div>
  );
}

export function BentoCard({ children, className, colSpan = 12, rowSpan = 1, priority = "secondary" }: BentoCardProps) {
  return (
    <div
      className={cn(
        "min-h-[160px] min-w-0 motion-safe:animate-[bento-fade-up_220ms_ease-out_both]",
        colSpan === 12 && "md:col-span-6 xl:col-span-12",
        colSpan === 8 && "md:col-span-6 xl:col-span-8",
        colSpan === 6 && "md:col-span-6 xl:col-span-6",
        colSpan === 4 && "md:col-span-3 xl:col-span-4",
        colSpan === 3 && "md:col-span-3 xl:col-span-3",
        rowSpan === 2 && "md:min-h-[280px] xl:row-span-2",
        rowSpan === 3 && "md:min-h-[420px] xl:row-span-3",
        priority === "hero" && "md:min-h-[240px]",
        priority === "primary" && "md:min-h-[190px]",
        priority === "secondary" && "md:min-h-[150px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
