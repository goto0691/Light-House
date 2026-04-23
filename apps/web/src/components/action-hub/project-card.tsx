import Link from "next/link";

import type { ProjectMock } from "@/lib/mock/action-hub";

export function ProjectCard({ project }: { project: ProjectMock }) {
  return (
    <Link className="glass block rounded-[24px] p-5 transition hover:translate-y-[-2px]" href={`/action-hub/${project.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-2xl">{project.icon}</p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">{project.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{project.category}</p>
        </div>
        <span className="rounded-full bg-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-primary">{project.kind}</span>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span>{project.progress}%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-white/8">
          <div className="h-2 rounded-full bg-[hsl(var(--primary))]" style={{ width: `${project.progress}%` }} />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{project.recentActivity}</span>
        <span className="text-foreground">{project.dueLabel}</span>
      </div>
    </Link>
  );
}
