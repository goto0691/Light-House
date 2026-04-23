"use client";

import { X } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface OverlayFrameProps extends PropsWithChildren {
  open: boolean;
  onClose: () => void;
  className?: string;
  panelClassName?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  headerSlot?: ReactNode;
}

export function OverlayFrame({ children, className, onClose, open, panelClassName, title, subtitle, headerSlot }: OverlayFrameProps) {
  if (!open) return null;

  return (
    <div
      aria-hidden={!open}
      className={cn("fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pb-6 pt-[12vh] backdrop-blur-sm", className)}
      onClick={onClose}
    >
      <div
        aria-modal="true"
        className={cn("glass-elevated w-full rounded-[28px] border border-white/10", panelClassName)}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {title ? (
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{title}</div>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              {headerSlot}
              <button
                aria-label="오버레이 닫기"
                className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/10 bg-black/10 text-muted-foreground transition [@media(hover:hover)]:hover:bg-white/8 [@media(hover:hover)]:hover:text-foreground"
                onClick={onClose}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
