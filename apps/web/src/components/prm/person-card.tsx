import Link from "next/link";

import { GlassCard } from "@/components/shared/glass-card";
import { PersonHealthBar } from "@/components/prm/person-health-bar";
import { Tag } from "@/components/shared/tag";
import type { PersonMock } from "@/lib/mock/prm";
import { getLayerColor } from "@/lib/mock/prm";
import { PERSON_LAYER_OPTIONS, PERSON_STATUS_OPTIONS } from "@/lib/properties/person";
import { optionLabel } from "@/lib/properties/types";

type PersonCardProps = {
  person: PersonMock;
  visibleFields?: string[];
};

const DEFAULT_VISIBLE_FIELDS = ["nickname", "favorite", "status", "layer", "groups", "bio", "cadence", "interactions", "lastContact", "birthday"];

export function PersonCard({ person, visibleFields = DEFAULT_VISIBLE_FIELDS }: PersonCardProps) {
  const overdue = person.daysSinceContact > person.cadenceDays;
  const visible = new Set(visibleFields);
  const showGroups = visible.has("groups");
  const showLayer = visible.has("layer");
  const showFooter = ["interactions", "gifts", "tasks", "lastContact", "birthday", "sourceDocument"].some((field) => visible.has(field));

  return (
    <GlassCard
      as={Link}
      className={overdue ? "shadow-[0_0_28px_rgba(239,68,68,0.15)]" : ""}
      href={`/prm?detail=person:${person.id}`}
      interactive
      priority="primary"
      scroll={false}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div
              aria-hidden="true"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-primary-foreground"
              style={{ backgroundColor: getLayerColor(person.layer) }}
            >
              {person.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <h2 className="text-balance truncate font-display text-2xl text-foreground">{person.name}</h2>
              {showLayer ? <p className="mt-1 text-xs text-muted-foreground">{optionLabel(PERSON_LAYER_OPTIONS, String(person.layer), `레이어 ${person.layer}`)}</p> : null}
            </div>
            {visible.has("nickname") && person.nickname ? <span className="text-sm text-muted-foreground">({person.nickname})</span> : null}
            {visible.has("favorite") && person.favorite ? <Tag value="즐겨찾기" variant="custom" /> : null}
          </div>
          {visible.has("bio") ? <p className="text-pretty mt-3 text-sm text-muted-foreground">{person.bio}</p> : null}
        </div>
        {visible.has("status") ? <Tag value={optionLabel(PERSON_STATUS_OPTIONS, person.status, person.status)} variant="status" /> : null}
      </div>

      {showGroups || showLayer ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {showGroups
            ? person.groups.map((group) => (
                <Tag className="normal-case tracking-normal" key={group} value={group} variant="custom" />
              ))
            : null}
          {showLayer ? <Tag value={`${person.layer}`} variant="dunbar" /> : null}
        </div>
      ) : null}

      {visible.has("cadence") ? <PersonHealthBar cadenceDays={person.cadenceDays} lastContactDays={person.daysSinceContact} /> : null}

      {showFooter ? (
        <div className="tabular-nums mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {visible.has("interactions") ? <span>상호작용 {person.interactionsCount}개</span> : null}
          {visible.has("gifts") ? <span>선물 {person.giftsCount}개</span> : null}
          {visible.has("tasks") ? <span>태스크 {person.tasksCount}개</span> : null}
          {visible.has("birthday") && person.upcomingBirthday ? <span>생일 {person.upcomingBirthday}</span> : null}
          {visible.has("lastContact") ? <span>마지막 연락 {person.daysSinceContact}일 전</span> : null}
          {visible.has("sourceDocument") && person.sourceDocument ? <span>원본 속성 {person.sourceDocument.properties.length}개</span> : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
