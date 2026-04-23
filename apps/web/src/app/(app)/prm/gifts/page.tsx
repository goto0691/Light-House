import { GlassCard } from "@/components/shared/glass-card";
import { getPRMGifts, getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";

export default async function GiftsPage() {
  await seedPRMSupportData();
  const gifts = await getPRMGifts();
  const snapshot = await getPRMSnapshot();
  const peopleMap = new Map(snapshot.people.map((person) => [person.id, person.name]));

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Gifts</p>
        <h1 className="mt-3 text-3xl font-semibold">선물 보드</h1>
        <div className="mt-5 space-y-3">
          {gifts.rows.filter((gift) => gift.direction === "given").map((gift) => (
            <GiftRow key={gift.id} personName={peopleMap.get(gift.personId) ?? "Unknown"} title={gift.title} subtitle={`${gift.occurredAt} · ${gift.satisfaction ?? "-"}`} />
          ))}
        </div>
      </GlassCard>
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Received</p>
        <h2 className="mt-3 text-3xl font-semibold">받은 선물</h2>
        <div className="mt-5 space-y-3">
          {gifts.rows.filter((gift) => gift.direction === "received").map((gift) => (
            <GiftRow key={gift.id} personName={peopleMap.get(gift.personId) ?? "Unknown"} title={gift.title} subtitle={`${gift.occurredAt} · ${gift.satisfaction ?? "-"}`} />
          ))}
        </div>
      </GlassCard>
    </section>
  );
}

function GiftRow({ personName, subtitle, title }: { personName: string; subtitle: string; title: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{personName}</p>
      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-primary">{subtitle}</p>
    </div>
  );
}
