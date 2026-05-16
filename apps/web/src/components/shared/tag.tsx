import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type TagVariant = "priority" | "energy" | "status" | "dunbar" | "neutral" | "custom";
type TagSize = "sm" | "md";

type TagProps = {
  variant: TagVariant;
  value: string;
  size?: TagSize;
  icon?: LucideIcon;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
};

function getTone(variant: TagVariant, value: string) {
  const normalized = value.toLowerCase();

  if (variant === "priority") {
    if (normalized === "p1") return "border-[hsl(var(--color-domain-priority-p1)/0.18)] bg-[hsl(var(--color-domain-priority-p1)/0.12)] text-[hsl(var(--color-domain-priority-p1))]";
    if (normalized === "p2") return "border-[hsl(var(--color-domain-priority-p2)/0.18)] bg-[hsl(var(--color-domain-priority-p2)/0.12)] text-[hsl(var(--color-domain-priority-p2))]";
    return "border-white/10 bg-white/6 text-muted-foreground";
  }

  if (variant === "energy") {
    if (normalized.includes("hyper")) return "border-[hsl(var(--color-domain-energy-hyperfocus)/0.18)] bg-[hsl(var(--color-domain-energy-hyperfocus)/0.14)] text-[hsl(var(--color-domain-energy-hyperfocus))]";
    if (normalized.includes("routine")) return "border-[hsl(var(--color-domain-energy-routine)/0.18)] bg-[hsl(var(--color-domain-energy-routine)/0.14)] text-[hsl(var(--color-domain-energy-routine))]";
    return "border-[hsl(var(--color-domain-energy-normal)/0.18)] bg-[hsl(var(--color-domain-energy-normal)/0.14)] text-[hsl(var(--color-domain-energy-normal))]";
  }

  if (variant === "status") {
    if (normalized.includes("done") || normalized.includes("active") || normalized.includes("완료") || normalized.includes("활성")) return "border-[hsl(var(--color-feedback-success)/0.18)] bg-[hsl(var(--color-feedback-success)/0.12)] text-[hsl(var(--color-feedback-success))]";
    if (normalized.includes("block") || normalized.includes("막힘")) return "border-[hsl(var(--color-feedback-danger)/0.18)] bg-[hsl(var(--color-feedback-danger)/0.12)] text-[hsl(var(--color-feedback-danger))]";
    if (normalized.includes("review") || normalized.includes("검토")) return "border-[hsl(var(--color-feedback-info)/0.18)] bg-[hsl(var(--color-feedback-info)/0.12)] text-[hsl(var(--color-feedback-info))]";
    return "border-[hsl(var(--color-feedback-warning)/0.18)] bg-[hsl(var(--color-feedback-warning)/0.12)] text-[hsl(var(--color-feedback-warning))]";
  }

  if (variant === "dunbar") {
    if (normalized.includes("5")) return "border-[hsl(var(--color-domain-dunbar-5)/0.18)] bg-[hsl(var(--color-domain-dunbar-5)/0.12)] text-[hsl(var(--color-domain-dunbar-5))]";
    if (normalized.includes("15")) return "border-[hsl(var(--color-domain-dunbar-15)/0.18)] bg-[hsl(var(--color-domain-dunbar-15)/0.12)] text-[hsl(var(--color-domain-dunbar-15))]";
    if (normalized.includes("50")) return "border-[hsl(var(--color-domain-dunbar-50)/0.18)] bg-[hsl(var(--color-domain-dunbar-50)/0.12)] text-[hsl(var(--color-domain-dunbar-50))]";
    return "border-[hsl(var(--color-domain-dunbar-150)/0.18)] bg-[hsl(var(--color-domain-dunbar-150)/0.12)] text-[hsl(var(--color-domain-dunbar-150))]";
  }

  return variant === "custom"
    ? "border-primary/20 bg-primary/10 text-primary"
    : "border-white/10 bg-white/6 text-muted-foreground";
}

export function Tag({ variant, value, size = "sm", icon: Icon, removable = false, onRemove, className }: TagProps) {
  const label = getTagLabel(value);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium uppercase tracking-[0.16em]",
        size === "sm" ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]",
        getTone(variant, value),
        className,
      )}
      role="status"
    >
      {Icon ? <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} /> : null}
      <span>{label}</span>
      {removable ? (
        <button
          aria-label={`${label} 제거`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-black/10 hover:bg-black/20"
          onClick={onRemove}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

function getTagLabel(value: string) {
  const normalized = value.toLowerCase().replaceAll("_", " ").trim();
  const labels: Record<string, string> = {
    active: "활성",
    blocked: "막힘",
    done: "완료",
    dormant: "휴면",
    favorite: "즐겨찾기",
    given: "준 선물",
    "hyper focus": "고집중",
    "in progress": "진행 중",
    normal: "보통",
    observing: "관찰",
    received: "받은 선물",
    review: "검토",
    routine: "루틴",
    todo: "예정",
    project: "프로젝트",
    area: "영역",
    paused: "보류",
    archived: "보관",
    "layer 5": "핵심 5",
    "layer 15": "친밀 15",
    "layer 50": "친구 50",
    "layer 150": "느슨한 150",
  };
  return labels[normalized] ?? value.replaceAll("_", " ");
}
