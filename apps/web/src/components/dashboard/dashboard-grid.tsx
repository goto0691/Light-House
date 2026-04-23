import type { ReactNode } from "react";

import { BentoGrid } from "@/components/shared/bento-grid";

export type WidgetKey =
  | "todays-anchor"
  | "active-tasks"
  | "hit-them-up"
  | "streak-heatmap"
  | "brain-energy"
  | "recent-zettels"
  | "birthdays"
  | "quote-of-day";

export type DashboardGridProps = {
  userLayout?: Record<WidgetKey, { span: number; rows: number; hidden: boolean; order: number }>;
  children: ReactNode;
};

export function DashboardGrid({ children }: DashboardGridProps) {
  return <BentoGrid>{children}</BentoGrid>;
}

