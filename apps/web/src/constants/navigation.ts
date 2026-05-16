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

import { DOMAIN_LABELS, UTILITY_LABELS } from "@/constants/display-labels";

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
  { key: "dashboard", label: DOMAIN_LABELS.dashboard, icon: Home, path: "/dashboard", hotkey: "g d" },
  { key: "action-hub", label: DOMAIN_LABELS["action-hub"], icon: Rocket, path: "/action-hub", hotkey: "g a" },
  { key: "vault", label: DOMAIN_LABELS.vault, icon: Brain, path: "/vault", hotkey: "g v" },
  { key: "prm", label: DOMAIN_LABELS.prm, icon: Users, path: "/prm", hotkey: "g p" },
  { key: "life-ops", label: DOMAIN_LABELS["life-ops"], icon: Settings2, path: "/life-ops", hotkey: "g l" },
];

export const UTILITY: NavigationItem[] = [
  { key: "search", label: UTILITY_LABELS.search, icon: Search, hotkey: "mod+k" },
  { key: "capture", label: UTILITY_LABELS.quickCapture, icon: Plus, hotkey: "mod+shift+n" },
  { key: "notifications", label: UTILITY_LABELS.notifications, icon: Bell, hotkey: "g n" },
  { key: "user", label: UTILITY_LABELS.account, icon: User, path: "/settings" },
];

export const LOCAL_NAV: Record<DomainKey, Array<{ label: string; href: string }>> = {
  dashboard: [
    { label: "오늘 앵커", href: "/dashboard" },
    { label: "어제 회고", href: "/dashboard/yesterday-review" },
    { label: "이번 주", href: "/dashboard/this-week" },
  ],
  "action-hub": [
    { label: "수신함", href: "/action-hub/inbox" },
    { label: "진행 프로젝트", href: "/action-hub" },
    { label: "보관함", href: "/action-hub/archive" },
  ],
  vault: [
    { label: "지식", href: "/vault/zettels" },
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
    { label: "오늘 기록", href: "/life-ops" },
    { label: "일일 기록", href: "/life-ops/entries" },
    { label: "습관", href: "/life-ops/habits" },
    { label: "운동", href: "/life-ops/workouts" },
    { label: "흐름", href: "/life-ops/trends" },
    { label: "커리어", href: "/life-ops/career" },
  ],
  settings: [
    { label: "프로필", href: "/settings/profile" },
    { label: "화면", href: "/settings/appearance" },
    { label: "데이터", href: "/settings/data" },
    { label: "원본 컬럼", href: "/settings/data/source-mapping" },
    { label: "연동", href: "/settings/integrations" },
    { label: "AI", href: "/settings/ai" },
    { label: "단축키", href: "/settings/shortcuts" },
  ],
};
