"use client";

import { useEffect, useId, useState } from "react";
import { scoreTier, scoreToAngle } from "@/lib/score-tier";

const SEGMENTS = [
  { label: "Poor", color: "oklch(0.42 0.018 66)" },
  { label: "Fair", color: "oklch(0.58 0.032 66)" },
  { label: "Good", color: "oklch(0.74 0.044 66)" },
  { label: "Excellent", color: "oklch(0.9247 0.0524 66.1732)" },
] as const;

const NEEDLE_COLOR = "var(--color-primary)";

type Props = {
  score: number;
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
}

function GaugeNeedle({
  cx,
  cy,
  r,
  angle,
}: {
  cx: number;
  cy: number;
  r: number;
  angle: number;
}) {
  const needleLen = r - 20;
  const hubR = 17;
  const needleW = 10;

  return (
    <g
      style={{
        transform: `rotate(${90 - angle}deg)`,
        transformOrigin: `${cx}px ${cy}px`,
        transition: "transform 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <line
        x1={cx}
        y1={cy - hubR + 3}
        x2={cx}
        y2={cy - needleLen}
        stroke={NEEDLE_COLOR}
        strokeWidth={needleW}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={hubR} fill={NEEDLE_COLOR} />
      <circle cx={cx} cy={cy} r={hubR - 5} fill="var(--color-card)" />
      <circle cx={cx} cy={cy} r={hubR - 9} fill={NEEDLE_COLOR} />
    </g>
  );
}

function CredScoreGaugeArc({
  score,
  showRangeLabels = false,
  className,
}: {
  score: number;
  showRangeLabels?: boolean;
  className?: string;
}) {
  const targetAngle = scoreToAngle(score);
  const [needleAngle, setNeedleAngle] = useState(180);
  const clipId = useId();

  useEffect(() => {
    const t = requestAnimationFrame(() => setNeedleAngle(targetAngle));
    return () => cancelAnimationFrame(t);
  }, [targetAngle]);

  const cx = 200;
  const cy = 168;
  const r = 128;
  const stroke = 18;
  const segmentSpan = 45;

  return (
    <svg
      viewBox="0 0 400 210"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="400" height="188" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {SEGMENTS.map((seg, i) => {
          const start = 180 - i * segmentSpan;
          const end = start - segmentSpan;
          return (
            <path
              key={seg.label}
              d={describeArc(cx, cy, r, start, end)}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeLinecap="butt"
            />
          );
        })}

        <GaugeNeedle cx={cx} cy={cy} r={r} angle={needleAngle} />
      </g>

      {showRangeLabels && (
        <>
          <text
            x={52}
            y={200}
            fill="var(--color-subtle)"
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            300
          </text>
          <text
            x={336}
            y={200}
            fill="var(--color-subtle)"
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            850
          </text>
        </>
      )}
    </svg>
  );
}

export function CredScoreGaugeMini({ score }: Props) {
  return (
    <CredScoreGaugeArc
      score={score}
      className="h-11 w-[4.25rem] shrink-0"
    />
  );
}

export function CredScoreGauge({ score }: Props) {
  const tier = scoreTier(score);

  return (
    <div className="mx-auto flex w-full max-w-[500px] flex-col items-center">
      <CredScoreGaugeArc
        score={score}
        showRangeLabels
        className="mx-auto block w-full min-h-[88px] max-h-[min(24vh,240px)] shrink"
      />

      <div className="mt-1 w-full shrink-0 text-center">
        <p className="section-label">CredScore</p>
        <p className="mt-1 text-[clamp(2.75rem,6vh,4.5rem)] leading-none font-[650] tabular-nums tracking-tight text-primary">
          {score}
        </p>
        <p className="mt-1.5 text-sm font-[650] uppercase tracking-[0.16em] text-primary">
          {tier.label}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{tier.description}</p>
      </div>
    </div>
  );
}
