export type ScoreTier = {
  label: "Poor" | "Fair" | "Good" | "Excellent";
  description: string;
  color: string;
  index: 0 | 1 | 2 | 3;
};

const TIERS: ScoreTier[] = [
  {
    label: "Poor",
    description: "Limited borrowing options",
    color: "var(--color-destructive)",
    index: 0,
  },
  {
    label: "Fair",
    description: "Room to strengthen your profile",
    color: "oklch(0.72 0.12 55)",
    index: 1,
  },
  {
    label: "Good",
    description: "Eligible for competitive rates",
    color: "var(--color-success)",
    index: 2,
  },
  {
    label: "Excellent",
    description: "Strong borrowing power",
    color: "oklch(0.78 0.19 145)",
    index: 3,
  },
];

export function scoreTier(score: number): ScoreTier {
  if (score >= 750) return TIERS[3];
  if (score >= 670) return TIERS[2];
  if (score >= 580) return TIERS[1];
  return TIERS[0];
}

export function scorePercent(score: number): number {
  return Math.min(100, Math.max(0, ((score - 300) / 550) * 100));
}

/** Needle angle in degrees: 180 = left (300), 0 = right (850). */
export function scoreToAngle(score: number): number {
  const clamped = Math.min(850, Math.max(300, score));
  const pct = (clamped - 300) / 550;
  return 180 - pct * 180;
}

export function sybilLabel(risk?: string): string {
  if (!risk) return "Pending";
  if (risk === "low") return "Verified";
  if (risk === "medium") return "Review";
  return "Flagged";
}

export type SybilVisual = "verified" | "pending" | "review" | "flagged";

export function sybilVisual(risk?: string): SybilVisual {
  if (!risk) return "pending";
  if (risk === "low") return "verified";
  if (risk === "medium") return "review";
  return "flagged";
}
