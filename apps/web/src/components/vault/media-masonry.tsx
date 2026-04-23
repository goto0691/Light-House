import { EmptyState } from "@/components/shared/empty-state";
import type { MediaMock } from "@/lib/mock/vault";

type MediaMasonryProps = {
  items: MediaMock[];
  renderCard: (item: MediaMock) => React.ReactNode;
};

export function MediaMasonry({ items, renderCard }: MediaMasonryProps) {
  if (!items.length) {
    return <EmptyState description="미디어 로그가 비어 있습니다." title="기록을 기다리는 서가" />;
  }

  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <div key={item.id}>{renderCard(item)}</div>)}</div>;
}
