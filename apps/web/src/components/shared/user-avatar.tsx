import { User } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type UserAvatarProps = {
  name?: string | null;
  imageUrl?: string | null;
  subtitle?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

function initialsFor(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function UserAvatar({ name, imageUrl, subtitle, size = "md", className }: UserAvatarProps) {
  const initials = initialsFor(name);

  return (
    <div className={cn("inline-flex min-w-0 items-center gap-3", className)}>
      <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/8 text-primary", sizeClasses[size])}>
        {imageUrl ? <img alt={name ?? "User"} className="h-full w-full object-cover" src={imageUrl} /> : initials || <User className="h-4 w-4" />}
      </span>
      {name || subtitle ? (
        <span className="min-w-0">
          {name ? <span className="block truncate text-sm font-medium text-foreground">{name}</span> : null}
          {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
