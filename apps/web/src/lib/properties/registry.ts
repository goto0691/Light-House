import type { PropertyDefinition } from "./types";
import { ASSET_PROPERTY_DEFINITIONS } from "./asset";
import { CAREER_PROPERTY_DEFINITIONS } from "./career";
import { DAILY_PROPERTY_DEFINITIONS } from "./daily";
import { GIFT_PROPERTY_DEFINITIONS } from "./gift";
import { HABIT_PROPERTY_DEFINITIONS } from "./habit";
import { MEDIA_PROPERTY_DEFINITIONS } from "./media";
import { PERSON_PROPERTY_DEFINITIONS } from "./person";
import { PLACE_PROPERTY_DEFINITIONS } from "./place";
import { PROJECT_PROPERTY_DEFINITIONS } from "./project";
import { TASK_PROPERTY_DEFINITIONS } from "./task";
import { WORKOUT_PROPERTY_DEFINITIONS } from "./workout";
import { ZETTEL_PROPERTY_DEFINITIONS } from "./zettel";

export const ALL_PROPERTY_DEFINITIONS: PropertyDefinition[] = [
  ...ZETTEL_PROPERTY_DEFINITIONS,
  ...MEDIA_PROPERTY_DEFINITIONS,
  ...PERSON_PROPERTY_DEFINITIONS,
  ...TASK_PROPERTY_DEFINITIONS,
  ...DAILY_PROPERTY_DEFINITIONS,
  ...PROJECT_PROPERTY_DEFINITIONS,
  ...HABIT_PROPERTY_DEFINITIONS,
  ...WORKOUT_PROPERTY_DEFINITIONS,
  ...CAREER_PROPERTY_DEFINITIONS,
  ...ASSET_PROPERTY_DEFINITIONS,
  ...PLACE_PROPERTY_DEFINITIONS,
  ...GIFT_PROPERTY_DEFINITIONS,
];

export function propertyDefinitionsFor(entityType: PropertyDefinition["entityType"]) {
  return ALL_PROPERTY_DEFINITIONS.filter((definition) => definition.entityType === entityType);
}
