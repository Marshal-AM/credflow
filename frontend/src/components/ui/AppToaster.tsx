"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast !bg-card !border !border-border/80 !text-foreground !shadow-lg !rounded-xl",
          title: "!text-sm !font-[650]",
          description: "!text-xs !text-muted-foreground",
          success: "!border-emerald-400/30",
          error: "!border-red-400/30",
          warning: "!border-primary/40",
          info: "!border-border/80",
        },
      }}
      closeButton
    />
  );
}
