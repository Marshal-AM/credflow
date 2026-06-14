import type { DefaultTestStatus } from "@/lib/test-default-server";

export type DefaultScenarioEligibility =
  | { state: "loading" }
  | { state: "blocked"; reason: string; hint?: string }
  | { state: "ready" };

export function getDefaultScenarioEligibility(
  status: DefaultTestStatus | null
): DefaultScenarioEligibility {
  if (!status) {
    return { state: "loading" };
  }

  if (status.hub.hubBlacklisted) {
    return {
      state: "blocked",
      reason: "Your wallet is blacklisted on Robinhood hub.",
      hint: "A prior default test blacklisted this wallet on hub and/or spokes. Use Whitelist wallet to reset hub blacklist, default count, and spoke LZ blacklist, then borrow again if you no longer have an active hub loan.",
    };
  }

  const hasHubLoan = status.ready.hasActiveLoan && Boolean(status.hub.loanId);

  if (!hasHubLoan) {
    const spokeLoans = status.spokes.filter((s) => s.lzLoanActive);

    if (spokeLoans.length > 0) {
      const labels = spokeLoans.map((s) => s.label).join(" and ");
      return {
        state: "blocked",
        reason: "No active loan on Robinhood hub.",
        hint: `You have loan mirrors on ${labels}, but this scenario liquidates a hub loan and broadcasts via LayerZero from hub. Borrow on Robinhood hub first.`,
      };
    }

    if (status.hub.score <= 0) {
      return {
        state: "blocked",
        reason: "No hub loan to default.",
        hint: "Complete Account scoring, mint your SBT, and borrow on Robinhood hub before running the default scenario.",
      };
    }

    return {
      state: "blocked",
      reason: "No active loan on Robinhood hub.",
      hint: "Borrow on Robinhood hub from the Loans tab, then return here to run the default scenario.",
    };
  }

  if (status.hub.loanId && !status.hub.loanActive) {
    return {
      state: "blocked",
      reason: "Hub loan is no longer active.",
      hint: "This loan was repaid or liquidated already. Borrow a new hub loan to test defaulting again.",
    };
  }

  return { state: "ready" };
}
