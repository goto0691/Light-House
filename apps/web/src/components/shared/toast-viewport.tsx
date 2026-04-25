"use client";

import { Toaster } from "sonner";

export function ToastViewport() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        className: "app-toast",
        classNames: {
          actionButton: "app-toast-action",
          cancelButton: "app-toast-cancel",
          closeButton: "app-toast-close",
          description: "app-toast-description",
          error: "app-toast-error",
          info: "app-toast-info",
          success: "app-toast-success",
          title: "app-toast-title",
          warning: "app-toast-warning",
        },
      }}
    />
  );
}
