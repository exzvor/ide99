import type { JSX } from "react";

interface SparklineProps {
  data: number[];
  height?: number;
  ariaLabel?: string;
}

/**
 * — pure-SVG sparkline (≤45 lines). Theme-aware via
 * `currentColor` + `style.color = var(--accent)`.
 *
 * - `data` empty → returns `null`.
 * - Single point → centered at x=50.
 * - min === max → flat line (no NaN; span fallback to 1).
 */
export function Sparkline({ data, height = 24, ariaLabel }: SparklineProps): JSX.Element | null {
  if (data.length === 0) return null;
  const w = 100;
  const h = height;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `M0,${h} L${pts} L${w},${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height, color: "var(--accent)" }}
      data-testid="sparkline"
    >
      <path d={area} fill="currentColor" opacity={0.15} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
