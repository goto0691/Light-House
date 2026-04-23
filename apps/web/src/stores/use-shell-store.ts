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
  quickCaptureContext: QuickCaptureContext | null;
  setLNBCollapsed: (collapsed: boolean) => void;
  toggleLNB: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openQuickCapture: (context?: QuickCaptureContext | null) => void;
  closeQuickCapture: () => void;
  openHotkeyDialog: () => void;
  closeHotkeyDialog: () => void;
};

export const useShellStore = create<ShellState>((set) => ({
  lnbCollapsed: false,
  commandPaletteOpen: false,
  quickCaptureOpen: false,
  hotkeyDialogOpen: false,
  quickCaptureContext: null,
  setLNBCollapsed: (collapsed) => set({ lnbCollapsed: collapsed }),
  toggleLNB: () => set((state) => ({ lnbCollapsed: !state.lnbCollapsed })),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openQuickCapture: (context) => set({ quickCaptureOpen: true, quickCaptureContext: context ?? null }),
  closeQuickCapture: () => set({ quickCaptureOpen: false }),
  openHotkeyDialog: () => set({ hotkeyDialogOpen: true }),
  closeHotkeyDialog: () => set({ hotkeyDialogOpen: false }),
}));
