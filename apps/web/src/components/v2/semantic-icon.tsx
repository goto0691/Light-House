import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  Dumbbell,
  Feather,
  FileQuestion,
  FileText,
  Footprints,
  Gamepad2,
  Image,
  Library,
  MapPin,
  MessagesSquare,
  NotebookTabs,
  PenLine,
  Quote,
  ScanLine,
  Sparkles,
  Star,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import { resolveSemanticIcon, type SemanticIconContext } from "@/lib/v2/presentation/semantic-icons";

const iconComponents: Record<string, LucideIcon> = {
  BookOpen,
  CalendarDays,
  Clapperboard,
  Dumbbell,
  Feather,
  FileQuestion,
  FileText,
  Footprints,
  Gamepad2,
  Image,
  Library,
  MapPin,
  MessagesSquare,
  NotebookTabs,
  PenLine,
  Quote,
  ScanLine,
  Sparkles,
  Star,
  Utensils,
};

export function SemanticIcon({
  iconKey,
  context,
  size = 18,
  className,
  decorative = true,
}: {
  iconKey?: string | null;
  context?: SemanticIconContext;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const definition = resolveSemanticIcon(iconKey, context);
  const Icon = iconComponents[definition.lucideName] ?? FileQuestion;

  return (
    <Icon
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : definition.label}
      className={className}
      focusable="false"
      size={size}
      strokeWidth={1.75}
    />
  );
}
