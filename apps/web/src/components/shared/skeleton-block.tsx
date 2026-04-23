import { cn } from "@/lib/utils/cn";

type SkeletonBlockProps = {
  variant?: "text" | "card" | "avatar" | "row" | "heatmap" | "sparkline" | "editor";
  count?: number;
  className?: string;
};

function getVariantClass(variant: NonNullable<SkeletonBlockProps["variant"]>) {
  switch (variant) {
    case "avatar":
      return "h-12 w-12 rounded-full";
    case "row":
      return "h-14 rounded-3xl";
    case "heatmap":
      return "h-32 rounded-[24px]";
    case "sparkline":
      return "h-20 rounded-[24px]";
    case "editor":
      return "h-64 rounded-[28px]";
    case "text":
      return "h-4 rounded-full";
    default:
      return "h-40 rounded-[28px]";
  }
}

export function SkeletonBlock({ variant = "text", count = 1, className }: SkeletonBlockProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          className={cn(
            "skeleton-shimmer",
            getVariantClass(variant),
          )}
          key={`${variant}-${index}`}
        />
      ))}
    </div>
  );
}
