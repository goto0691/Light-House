import { EmptyState } from "@/components/shared/empty-state";
import type { GiftMock } from "@/lib/mock/prm";

type GiftBoardProps = {
  title: string;
  gifts: GiftMock[];
  renderGift: (gift: GiftMock) => React.ReactNode;
};

export function GiftBoard({ title, gifts, renderGift }: GiftBoardProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-3xl text-foreground">{title}</h2>
        <span className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{gifts.length} items</span>
      </div>
      {gifts.length ? (
        <div className="space-y-3">{gifts.map((gift) => <div key={gift.id}>{renderGift(gift)}</div>)}</div>
      ) : (
        <EmptyState description="아직 기록된 선물이 없습니다." title={`${title} is empty`} />
      )}
    </section>
  );
}
