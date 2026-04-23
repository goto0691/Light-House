"use client";

import type { PropsWithChildren, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface OverlayFrameProps extends PropsWithChildren {
  open: boolean;
  onClose: () => void;
  className?: string;
  panelClassName?: string;
  title?: ReactNode;
}

export function OverlayFrame({ children, className, onClose, open, panelClassName, title }: OverlayFrameProps) {
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
        {title ? <div className="border-b border-white/10 px-5 py-4 text-sm font-medium text-foreground">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}
