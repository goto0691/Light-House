"use client";

import { create } from "zustand";

type QuickCaptureContext = {
  domain?: string;
  label?: string;
  projectId?: string | null;
  personId?: string | null;
};

type ShellState = {
  lnbCollapsed: boolean;
  commandPaletteOpen: boolean;
  quickCaptureOpen: boolean;
  hotkeyDialogOpen: boolean;
  notificationCenterOpen: boolean;
  quickCaptureContext: QuickCaptureContext | null;
  quickCaptureSeedText: string;
  setLNBCollapsed: (collapsed: boolean) => void;
  toggleLNB: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openQuickCapture: (context?: QuickCaptureContext | null, seedText?: string) => void;
  closeQuickCapture: () => void;
  openHotkeyDialog: () => void;
  closeHotkeyDialog: () => void;
  openNotificationCenter: () => void;
  closeNotificationCenter: () => void;
};

export const useShellStore = create<ShellState>((set) => ({
  lnbCollapsed: false,
  commandPaletteOpen: false,
  quickCaptureOpen: false,
  hotkeyDialogOpen: false,
  notificationCenterOpen: false,
  quickCaptureContext: null,
  quickCaptureSeedText: "",
  setLNBCollapsed: (collapsed) => set({ lnbCollapsed: collapsed }),
  toggleLNB: () => set((state) => ({ lnbCollapsed: !state.lnbCollapsed })),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openQuickCapture: (context, seedText) => set({ quickCaptureOpen: true, quickCaptureContext: context ?? null, quickCaptureSeedText: seedText ?? "" }),
  closeQuickCapture: () => set({ quickCaptureOpen: false, quickCaptureSeedText: "" }),
  openHotkeyDialog: () => set({ hotkeyDialogOpen: true }),
  closeHotkeyDialog: () => set({ hotkeyDialogOpen: false }),
  openNotificationCenter: () => set({ notificationCenterOpen: true }),
  closeNotificationCenter: () => set({ notificationCenterOpen: false }),
}));
