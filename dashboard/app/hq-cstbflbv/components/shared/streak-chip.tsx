'use client';

/* ---------------------------------------------------------------------------
 * StreakChip — a habit's current run of days.
 *
 * Warm when it is alive, cold and quiet at zero: a broken streak should never
 * shout at you. The numeral flips in whenever the count changes.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import { Flame } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

export interface StreakChipProps {
  /** Days in the current run. `0` renders the cold variant. */
  count: number;
  className?: string;
}

export function StreakChip({ count, className }: StreakChipProps): JSX.Element {
  const reduce = useReducedMotion();
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const cold = safe === 0;
  const label = cold ? 'No current streak' : `${safe} day streak`;

  /* The numeral is keyed on the count, so a change remounts it and the flip
   * plays. On the very first paint there is nothing to flip FROM, and the chip
   * is usually already riding a parent's entrance — so mount renders flat and
   * only later changes animate. */
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const enter = !mounted.current
    ? false
    : reduce
      ? { opacity: 0 }
      : { opacity: 0, y: -5, scale: 0.86 };

  return (
    <span
      className={clsx('pa-flame select-none', className)}
      data-cold={cold ? 'true' : 'false'}
      role="img"
      aria-label={label}
      data-tip={label}
    >
      <Flame
        className="size-3.5 shrink-0"
        strokeWidth={1.75}
        fill={cold ? 'none' : 'currentColor'}
        fillOpacity={cold ? 0 : 0.16}
        aria-hidden="true"
      />
      <motion.span
        key={safe}
        className="tabular-nums leading-none"
        initial={enter}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      >
        {safe}
      </motion.span>
    </span>
  );
}
