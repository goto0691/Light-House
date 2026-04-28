import type { ReactNode } from "react";

import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";

type CollectionMetric = {
  label: string;
  value: ReactNode;
};

type CollectionShellProps = {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  metrics?: CollectionMetric[];
  toolbar?: ReactNode;
  aside?: ReactNode;
  asideWidth?: "sm" | "md" | "lg";
  children: ReactNode;
};

export function CollectionShell({
  eyebrow,
  title,
  description,
  metrics = [],
  toolbar,
  aside,
  asideWidth = "md",
  children,
}: CollectionShellProps) {
  return (
    <PageLayout>
      <PageHeader
        description={description}
        eyebrow={eyebrow}
        meta={
          metrics.length ? (
            <div className="grid w-full gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3" key={metric.label}>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{metric.label}</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{metric.value}</p>
                </div>
              ))}
            </div>
          ) : null
        }
        title={title}
      />
      {toolbar ? <PageToolbar>{toolbar}</PageToolbar> : null}
      <PageBody aside={aside} asideWidth={asideWidth}>
        {children}
      </PageBody>
    </PageLayout>
  );
}
