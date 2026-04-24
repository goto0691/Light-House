import { ContextNodeCard } from "@/components/shared/context/context-node-card";
import type { ContextBundle, ContextNode } from "@/lib/context/types";

export function ContextTimeline({ bundle, onOpenNode }: { bundle: ContextBundle; onOpenNode?: (node: ContextNode) => void }) {
  if (!bundle.timeline.length) {
    return (
      <section className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">
        날짜로 묶인 맥락 기록이 아직 없습니다.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-primary">Context Timeline</p>
      <div className="mt-4 grid gap-3">
        {bundle.timeline.map((item) => (
          <div className="grid gap-2 border-l border-white/10 pl-3" key={`${item.date}:${item.nodes.map((node) => node.id).join(":")}`}>
            <p className="text-xs font-medium text-muted-foreground">{item.date}</p>
            {item.nodes.map((node) => (
              <ContextNodeCard compact key={`${node.type}:${node.id}`} node={node} onOpen={onOpenNode} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
