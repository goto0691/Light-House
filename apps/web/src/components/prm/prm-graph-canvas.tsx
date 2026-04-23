import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { NetworkEdgeMock, PersonMock } from "@/lib/mock/prm";

type PRMGraphCanvasProps = {
  people: PersonMock[];
  edges: NetworkEdgeMock[];
  onDeleteEdge: (edgeId: string) => void;
};

export function PRMGraphCanvas({ people, edges, onDeleteEdge }: PRMGraphCanvasProps) {
  const peopleMap = new Map(people.map((person) => [person.id, person]));

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {people.map((person) => {
        const connected = edges.filter((edge) => edge.sourcePersonId === person.id || edge.targetPersonId === person.id);
        return (
          <GlassCard className="p-4" key={person.id}>
            <p className="font-display text-2xl text-foreground">{person.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{person.groups.join(" · ")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Tag value={`${person.layer}`} variant="dunbar" />
              <Tag value={person.status} variant="status" />
            </div>
            <div className="mt-4 space-y-2">
              {connected.length ? (
                connected.map((edge) => {
                  const otherId = edge.sourcePersonId === person.id ? edge.targetPersonId : edge.sourcePersonId;
                  const other = peopleMap.get(otherId);
                  return (
                    <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3" key={edge.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-foreground">{other?.name ?? "Unknown"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {(edge.relationType ?? "연결").toUpperCase()} · 강도 {edge.strength}
                          </p>
                        </div>
                        <button className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" onClick={() => onDeleteEdge(edge.id)} type="button">
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">아직 연결선이 없습니다.</p>
              )}
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
