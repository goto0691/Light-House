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
      return "h-14 rounded-md";
    case "heatmap":
      return "h-32 rounded-lg";
    case "sparkline":
      return "h-20 rounded-lg";
    case "editor":
      return "h-64 rounded-lg";
    case "text":
      return "h-4 rounded-md";
    default:
      return "h-40 rounded-lg";
  }
}

export function SkeletonBlock({ variant = "text", count = 1, className }: SkeletonBlockProps) {
  return (
    <div aria-hidden="true" className={cn("space-y-3", className)}>
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
