"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmLeaveDialog } from "@/components/ui/ConfirmLeaveDialog";

type PendingNavigation = () => void;

type ScoreFlowGuardContextValue = {
  scoringActive: boolean;
  setScoringActive: (active: boolean) => void;
  requestNavigation: (action: PendingNavigation) => void;
};

const ScoreFlowGuardContext = createContext<ScoreFlowGuardContextValue | null>(null);

export function ScoreFlowGuardProvider({ children }: { children: ReactNode }) {
  const [scoringActive, setScoringActive] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingNavigation | null>(null);
  const scoringActiveRef = useRef(scoringActive);
  scoringActiveRef.current = scoringActive;

  const requestNavigation = useCallback((action: PendingNavigation) => {
    if (!scoringActiveRef.current) {
      action();
      return;
    }
    setPendingNav(() => action);
  }, []);

  const confirmLeave = useCallback(() => {
    const action = pendingNav;
    setPendingNav(null);
    setScoringActive(false);
    action?.();
  }, [pendingNav]);

  const value = useMemo(
    () => ({ scoringActive, setScoringActive, requestNavigation }),
    [scoringActive, requestNavigation]
  );

  return (
    <ScoreFlowGuardContext.Provider value={value}>
      {children}
      <ConfirmLeaveDialog
        open={pendingNav != null}
        onStay={() => setPendingNav(null)}
        onLeave={confirmLeave}
      />
    </ScoreFlowGuardContext.Provider>
  );
}

export function useScoreFlowGuard(): ScoreFlowGuardContextValue {
  const ctx = useContext(ScoreFlowGuardContext);
  if (!ctx) {
    throw new Error("useScoreFlowGuard must be used within ScoreFlowGuardProvider");
  }
  return ctx;
}
