"use client";

import type { ReactNode } from "react";

export function AccountScoreWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className="account-dashboard pb-1">
      <section className="card-padded min-h-[24rem]">{children}</section>
    </div>
  );
}
