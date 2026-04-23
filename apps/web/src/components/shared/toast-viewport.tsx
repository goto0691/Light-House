"use client";

import { Toaster } from "sonner";

export function ToastViewport() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      toastOptions={{
        className: "glass border border-white/10 !text-foreground",
      }}
    />
  );
}
