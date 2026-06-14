"use client";

import { useEffect, useRef } from "react";
import { useScoreFlowGuard } from "@/contexts/ScoreFlowGuardContext";

/** Browser back + tab-close warnings while scoring is in progress. */
export function useScoreFlowNavigationGuard(active: boolean) {
  const { setScoringActive, requestNavigation } = useScoreFlowGuard();
  const historyPushedRef = useRef(false);

  useEffect(() => {
    setScoringActive(active);
    return () => setScoringActive(false);
  }, [active, setScoringActive]);

  useEffect(() => {
    if (!active) {
      historyPushedRef.current = false;
      return;
    }

    if (!historyPushedRef.current) {
      window.history.pushState({ scoreFlowGuard: true }, "", window.location.href);
      historyPushedRef.current = true;
    }

    const onPopState = () => {
      window.history.pushState({ scoreFlowGuard: true }, "", window.location.href);
      requestNavigation(() => {
        historyPushedRef.current = false;
        window.history.back();
      });
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, requestNavigation]);
}
