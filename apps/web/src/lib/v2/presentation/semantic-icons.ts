export type SemanticIconContext = "type" | "template" | "saved_view";

export type SemanticIconDefinition = Readonly<{
  key: string;
  label: string;
  lucideName: string;
  allowedContexts: readonly SemanticIconContext[];
  fallbackKey?: string;
}>;

export const DEFAULT_SEMANTIC_ICON_KEY = "type.unknown";

export const semanticIconCatalog = [
  { key: "type.unknown", label: "분류되지 않은 기록", lucideName: "FileQuestion", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.document", label: "문서", lucideName: "FileText", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.collection", label: "모음", lucideName: "Library", allowedContexts: ["type", "saved_view"] },
  { key: "type.template", label: "템플릿", lucideName: "NotebookTabs", allowedContexts: ["template"] },
  { key: "type.event", label: "사건", lucideName: "CalendarDays", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.review", label: "리뷰", lucideName: "Star", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.place", label: "장소", lucideName: "MapPin", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.movie", label: "영상 작품", lucideName: "Clapperboard", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.game", label: "게임", lucideName: "Gamepad2", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.workout", label: "운동", lucideName: "Dumbbell", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.running", label: "달리기", lucideName: "Footprints", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.restaurant", label: "식당", lucideName: "Utensils", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.book", label: "책", lucideName: "BookOpen", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.essay", label: "에세이", lucideName: "PenLine", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.poem", label: "시", lucideName: "Feather", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.conversation", label: "대화", lucideName: "MessagesSquare", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.quote", label: "인용", lucideName: "Quote", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.image", label: "이미지", lucideName: "Image", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.screenshot", label: "스크린샷", lucideName: "ScanLine", allowedContexts: ["type", "template", "saved_view"] },
  { key: "type.meditation", label: "묵상", lucideName: "Sparkles", allowedContexts: ["type", "template", "saved_view"] },
] as const satisfies readonly SemanticIconDefinition[];

const semanticIconByKey = new Map<string, SemanticIconDefinition>(semanticIconCatalog.map((definition) => [definition.key, definition]));

export function resolveSemanticIcon(key: string | null | undefined, context?: SemanticIconContext): SemanticIconDefinition {
  const definition = key ? semanticIconByKey.get(key) : undefined;
  if (definition && (!context || definition.allowedContexts.includes(context))) return definition;
  return semanticIconByKey.get(DEFAULT_SEMANTIC_ICON_KEY) as SemanticIconDefinition;
}

export function isAllowedSemanticIcon(key: string, context: SemanticIconContext) {
  const definition = semanticIconByKey.get(key);
  return Boolean(definition?.allowedContexts.includes(context));
}

export function suggestSemanticIconForType(typeKey: string | null | undefined) {
  const key = (typeKey ?? "").toLowerCase();
  const candidate = key.includes("running") ? "type.running"
    : key.includes("workout") ? "type.workout"
      : key.includes("restaurant") ? "type.restaurant"
        : key.includes("place") || key.includes("visit") ? "type.place"
          : key.includes("movie") || key.includes("film") ? "type.movie"
            : key.includes("game") ? "type.game"
              : key.includes("book") ? "type.book"
                : key.includes("essay") ? "type.essay"
                  : key.includes("poem") ? "type.poem"
                    : key.includes("meditation") ? "type.meditation"
                      : key.includes("conversation") || key.includes("transcript") ? "type.conversation"
                        : "type.document";
  return isAllowedSemanticIcon(candidate, "type") ? candidate : DEFAULT_SEMANTIC_ICON_KEY;
}
