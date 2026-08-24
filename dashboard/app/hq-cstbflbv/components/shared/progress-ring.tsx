'use client';

/* ---------------------------------------------------------------------------
 * ProgressRing — the circular readout used for the day hero and goal cards.
 *
 * The stroke colours live in assistant.css, which references
 * `url(#pa-ring-gradient)`. That id is therefore FIXED, not generated: every
 * instance renders its own identical `<defs>`. Duplicate ids in SVG defs are
 * harmless — the first match wins and every match is the same gradient — and
 * the alternative (a unique id per instance) would need the CSS to stop owning
 * the stroke, which is worse.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface ProgressRingProps {
  /** 0–1. Anything outside that range (or NaN) is clamped. */
  value: number;
  /** Outer diameter in px. */
  size?: number;
  /** Track/fill stroke width in px. */
  stroke?: number;
  /** Centre content. Defaults to the rounded percentage. */
  label?: ReactNode;
  /** Small tracked caption under the label. */
  sublabel?: string;
  className?: string;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function ProgressRing({
  value,
  size = 72,
  stroke = 6,
  label,
  sublabel,
  className,
}: ProgressRingProps): JSX.Element {
  const ratio = clampRatio(value);
  const percent = Math.round(ratio * 100);

  const diameter = Math.max(stroke * 3, size);
  const centre = diameter / 2;
  const radius = Math.max(1, (diameter - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);

  // Type scales with the ring so one component covers 44px chips and 160px heroes.
  const labelSize = Math.max(11, Math.round(diameter * 0.26));
  const sublabelSize = Math.max(9, Math.round(diameter * 0.115));

  return (
    <div
      className={clsx('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: diameter, height: diameter }}
      role="img"
      aria-label={sublabel ? `${percent}% — ${sublabel}` : `${percent}% complete`}
    >
      <svg
        width={diameter}
        height={diameter}
        viewBox={`0 0 ${diameter} ${diameter}`}
        className="-rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* Token-only stops, no hex fallbacks — a literal would freeze the
           * ring in its light-mode colours. Both tokens flip with
           * `data-pa-theme`, and the pairing is what makes the ring read in
           * either theme: azure into deep navy on white, azure into a near
           * white on the dark stage, so the arc always ENDS brighter than the
           * surface it is drawn on. */}
          <linearGradient id="pa-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--pa-azure)" />
            <stop offset="55%" stopColor="var(--pa-azure)" stopOpacity={0.92} />
            <stop offset="100%" stopColor="var(--pa-navy)" />
          </linearGradient>
        </defs>

        <circle
          className="pa-ring-track"
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />

        <circle
          className="pa-ring-fill"
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          // A round cap on a fully-offset dash can leave a stray dot at 12 o'clock.
          strokeOpacity={ratio === 0 ? 0 : 1}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[1px] px-1">
        <span
          className="pa-display tabular-nums leading-none"
          style={{ fontSize: labelSize }}
          aria-hidden="true"
        >
          {label ?? `${percent}%`}
        </span>

        {sublabel ? (
          <span
            className="max-w-full truncate uppercase leading-none tracking-[0.12em] text-[color:var(--pa-faint)]"
            style={{ fontSize: sublabelSize }}
            aria-hidden="true"
          >
            {sublabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
