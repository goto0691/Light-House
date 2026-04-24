import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type PageLayoutProps = {
  children: ReactNode;
  className?: string;
};

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

type PageBodyProps = {
  children: ReactNode;
  aside?: ReactNode;
  asidePosition?: "left" | "right";
  asideWidth?: "sm" | "md" | "lg";
  className?: string;
};

export function PageLayout({ children, className }: PageLayoutProps) {
  return <section className={cn("app-page", className)}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("app-page-header", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="app-page-eyebrow">{eyebrow}</p> : null}
        <h1 className="app-page-title">{title}</h1>
        {description ? <p className="app-page-description">{description}</p> : null}
        {meta ? <div className="app-page-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="app-page-actions">{actions}</div> : null}
    </header>
  );
}

export function PageToolbar({ children, className }: PageLayoutProps) {
  return <div className={cn("app-page-toolbar", className)}>{children}</div>;
}

export function PageBody({ children, aside, asidePosition = "right", asideWidth = "md", className }: PageBodyProps) {
  if (!aside) {
    return <div className={cn("app-page-body", className)}>{children}</div>;
  }

  return (
    <div
      className={cn(
        "app-page-body app-page-body-with-aside",
        asidePosition === "left" && "app-page-body-aside-left",
        asideWidth === "sm" && "app-page-body-aside-sm",
        asideWidth === "lg" && "app-page-body-aside-lg",
        className,
      )}
    >
      <main className="app-page-main">{children}</main>
      <aside className="app-page-aside">{aside}</aside>
    </div>
  );
}
