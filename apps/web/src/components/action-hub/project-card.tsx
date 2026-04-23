import Link from "next/link";

import { Tag } from "@/components/shared/tag";
import type { ProjectMock } from "@/lib/mock/action-hub";

export function ProjectCard({ project }: { project: ProjectMock }) {
  const circumference = 2 * Math.PI * 24;
  const dashOffset = circumference - (circumference * project.progress) / 100;

  return (
    <Link className="glass block rounded-[28px] p-5 transition hover:-translate-y-1 hover:shadow-[var(--shadow-glow),var(--shadow-lg)]" href={`/action-hub/${project.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-2xl">{project.icon}</p>
          <h2 className="mt-3 font-display text-[1.4rem] leading-7 text-foreground">{project.title}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Tag value={project.category} variant="custom" />
            <Tag value={project.kind} variant="neutral" />
          </div>
        </div>
        <div className="relative h-14 w-14 shrink-0">
          <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56">
            <circle cx="28" cy="28" fill="none" r="24" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
            <circle
              cx="28"
              cy="28"
              fill="none"
              r="24"
              stroke="hsl(var(--primary))"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth="5"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-foreground">{project.progress}%</span>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Tag value="P1" variant="priority" />
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{project.dueLabel}</span>
      </div>

      <div className="mt-5 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{project.recentActivity}</span>
        <span className="text-foreground">Open</span>
      </div>
    </Link>
  );
}
