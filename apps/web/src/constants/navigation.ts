import {
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
  | "life-ops";

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
  { key: "user", label: "Account", icon: User, path: "/settings" },
];

export const LOCAL_NAV: Record<DomainKey, Array<{ label: string; href: string }>> = {
  dashboard: [
    { label: "Today's Anchor", href: "/dashboard" },
    { label: "Yesterday Review", href: "/dashboard?range=yesterday" },
    { label: "This Week", href: "/dashboard?range=week" },
  ],
  "action-hub": [
    { label: "Inbox", href: "/action-hub/inbox" },
    { label: "Active Projects", href: "/action-hub" },
    { label: "Archive", href: "/action-hub?view=archive" },
  ],
  vault: [
    { label: "Zettels", href: "/vault" },
    { label: "Media", href: "/vault?view=media" },
    { label: "Graph View", href: "/vault?view=graph" },
  ],
  prm: [
    { label: "Hit Them Up", href: "/prm?filter=needs-contact" },
    { label: "People", href: "/prm" },
    { label: "Gifts", href: "/prm?view=gifts" },
  ],
  "life-ops": [
    { label: "Today's Log", href: "/life-ops" },
    { label: "Calendar", href: "/life-ops?view=calendar" },
    { label: "Trends", href: "/life-ops?view=trends" },
  ],
};
