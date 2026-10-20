"use client";

import { cn } from "@/lib/utils";

interface RiskGaugeProps {
  /** Risk score 0–100. */
  value: number;
  /** Optional label below the number (e.g. "HIGH"). */
  level?: string;
  /** Size in pixels (default 160). */
  size?: number;
  /** Stroke width (default 14). */
  stroke?: number;
  className?: string;
}

/**
 * RiskGauge — SVG circular gauge 0–100 with color bands.
 *   - 0–25   green   (LOW)
 *   - 25–50  amber   (MEDIUM)
 *   - 50–75  orange  (HIGH)
 *   - 75–100 red     (CRITICAL)
 *
 * Center shows the numeric value and optional risk level.
 */
export function RiskGauge({
  value,
  level,
  size = 160,
  stroke = 14,
  className,
}: RiskGaugeProps) {
  const v = Math.max(0, Math.min(100, value));
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  // Background track occupies 270° of the circle (from 135° around to 45°).
  const arcFraction = 0.75;
  const arcLength = circumference * arcFraction;
  // Value arc
  const valueFraction = v / 100;
  const valueLength = arcLength * valueFraction;
  // Rotate so the gap is at the bottom: 135° start.
  const rotation = 135;

  const colorFor = (n: number) => {
    if (n < 25) return "var(--accent)";      // green
    if (n < 50) return "var(--chart-5)";     // amber
    if (n < 75) return "var(--primary)";    // orange
    return "var(--destructive)";            // red
  };
  const color = colorFor(v);

  return (
    <div
      className={cn("relative inline-flex flex-col items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Risk score ${v} out of 100, level ${level || ""}`.trim()}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-0"
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${cx} ${cy})`}
        />
        {/* Value arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${valueLength} ${circumference - valueLength}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 600ms ease, stroke 200ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-3xl font-bold tabular-nums text-foreground"
          style={{ color }}
        >
          {Math.round(v)}
        </span>
        {level ? (
          <span className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {level}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default RiskGauge;
