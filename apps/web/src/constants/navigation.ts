import {
  Bell,
  Brain,
  Home,
  Plus,
  Rocket,
  Search,
  Settings2,
  User,
  type LucideIcon,
  Users,
} from "lucide-react";

export type DomainKey =
  | "dashboard"
  | "action-hub"
  | "vault"
  | "prm"
  | "life-ops"
  | "settings";

export interface NavigationItem {
  key: string;
  label: string;
  path?: string;
  hotkey?: string;
  icon: LucideIcon;
}

export const DOMAINS: NavigationItem[] = [
  { key: "dashboard", label: "Dashboard", icon: Home, path: "/dashboard", hotkey: "g d" },
  { key: "action-hub", label: "Action Hub", icon: Rocket, path: "/action-hub", hotkey: "g a" },
  { key: "vault", label: "The Vault", icon: Brain, path: "/vault", hotkey: "g v" },
  { key: "prm", label: "PRM", icon: Users, path: "/prm", hotkey: "g p" },
  { key: "life-ops", label: "Life Ops", icon: Settings2, path: "/life-ops", hotkey: "g l" },
];

export const UTILITY: NavigationItem[] = [
  { key: "search", label: "Search", icon: Search, hotkey: "mod+k" },
  { key: "capture", label: "Quick Capture", icon: Plus, hotkey: "mod+shift+n" },
  { key: "notifications", label: "Notifications", icon: Bell, hotkey: "g n" },
  { key: "user", label: "Account", icon: User, path: "/settings" },
];

export const LOCAL_NAV: Record<DomainKey, Array<{ label: string; href: string }>> = {
  dashboard: [
    { label: "Today's Anchor", href: "/dashboard" },
    { label: "Yesterday Review", href: "/dashboard/yesterday-review" },
    { label: "This Week", href: "/dashboard/this-week" },
  ],
  "action-hub": [
    { label: "Inbox", href: "/action-hub/inbox" },
    { label: "Active Projects", href: "/action-hub" },
    { label: "Archive", href: "/action-hub/archive" },
  ],
  vault: [
    { label: "제텔", href: "/vault/zettels" },
    { label: "미디어", href: "/vault/media" },
    { label: "자산", href: "/vault/assets" },
    { label: "장소", href: "/vault/places" },
    { label: "그래프", href: "/vault/zettels/graph" },
  ],
  prm: [
    { label: "연락 필요", href: "/prm/hit-them-up" },
    { label: "사람", href: "/prm" },
    { label: "선물", href: "/prm/gifts" },
    { label: "관계 그래프", href: "/prm/graph" },
  ],
  "life-ops": [
    { label: "Today's Log", href: "/life-ops" },
    { label: "Daily Entries", href: "/life-ops/entries" },
    { label: "Habits", href: "/life-ops/habits" },
    { label: "Workouts", href: "/life-ops/workouts" },
    { label: "Trends", href: "/life-ops/trends" },
    { label: "Career", href: "/life-ops/career" },
  ],
  settings: [
    { label: "Profile", href: "/settings/profile" },
    { label: "Appearance", href: "/settings/appearance" },
    { label: "Data", href: "/settings/data" },
    { label: "원본 컬럼", href: "/settings/data/source-mapping" },
    { label: "Integrations", href: "/settings/integrations" },
    { label: "AI", href: "/settings/ai" },
    { label: "Shortcuts", href: "/settings/shortcuts" },
  ],
};
