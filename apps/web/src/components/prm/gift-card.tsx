import { GlassCard } from "@/components/shared/glass-card";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import type { GiftMock } from "@/lib/mock/prm";
import { GIFT_PROPERTY_DEFINITIONS, GIFT_PROPERTY_GROUPS } from "@/lib/properties/gift";
import Link from "next/link";

type GiftCardProps = {
  gift: GiftMock;
  personName: string;
  onDelete: () => void;
  visibleFields?: string[];
};

const GIFT_CARD_DEFINITIONS = GIFT_PROPERTY_DEFINITIONS.filter((definition) => definition.field !== "title");
const DEFAULT_VISIBLE_FIELDS = GIFT_CARD_DEFINITIONS.filter((definition) => definition.defaultVisibleInList).map((definition) => definition.field);

export function GiftCard({ gift, personName, onDelete, visibleFields = DEFAULT_VISIBLE_FIELDS }: GiftCardProps) {
  const definitions = GIFT_CARD_DEFINITIONS.filter((definition) => visibleFields.includes(definition.field));

  return (
    <GlassCard className="p-4">
      <Link className="block" href={`/prm/gifts/${gift.id}`}>
        <p className="font-display text-2xl text-foreground">{gift.title}</p>
        <PropertySummary
          className="mt-4"
          definitions={definitions}
          groups={GIFT_PROPERTY_GROUPS}
          mode="all"
          record={gift}
          showGroupLabels={false}
          showTitle={false}
          valueOverrides={{ personId: personName }}
        />
      </Link>
      <button className="mt-4 rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] tracking-[0.08em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" onClick={onDelete} type="button">
        삭제
      </button>
    </GlassCard>
  );
}
