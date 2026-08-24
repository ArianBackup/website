'use client';

/* ---------------------------------------------------------------------------
 * Meter — the horizontal progress bar used for goals, milestones and days.
 *
 * The track and the gradient fill live in assistant.css; this component owns
 * only the clamping, the width and the accessibility contract.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';

export interface MeterProps {
  /** 0–1. Anything outside that range (or NaN) is clamped. */
  value: number;
  /** Force the green "finished" fill. Defaults to `value >= 1`. */
  complete?: boolean;
  /** Slimmer track, for dense rows. */
  thin?: boolean;
  className?: string;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function Meter({ value, complete, thin, className }: MeterProps): JSX.Element {
  const ratio = clampRatio(value);
  const percent = Math.round(ratio * 100);
  const isComplete = complete ?? ratio >= 1;

  return (
    <div
      className={clsx('pa-meter', thin && 'pa-meter-thin', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`${percent}% complete`}
    >
      <div
        className="pa-meter-fill"
        data-complete={isComplete ? 'true' : 'false'}
        // The glow on the fill would bleed out of a zero-width box, so an empty
        // meter hides the fill entirely rather than showing a stray dot.
        //
        // The stylesheet only transitions `width`, so that hide/show used to
        // pop. Restating the transition here (inline, to outrank the more
        // specific `.assistant-shell .pa-meter-fill` rule) fades the fill in as
        // the first unit of progress lands. The reduced-motion block in
        // assistant.css uses `!important`, so it still wins over this.
        style={{
          width: `${ratio * 100}%`,
          opacity: ratio === 0 ? 0 : 1,
          transition: 'width 0.55s var(--pa-ease), opacity 0.35s ease',
        }}
      />
    </div>
  );
}
