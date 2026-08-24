'use client';

/* ---------------------------------------------------------------------------
 * macro-line.tsx — protein, fat and carbs, said honestly.
 *
 * Two shapes of the same statement:
 *
 *   <MacroStrip>  the day's summary under the meter — labelled, spaced out
 *   <MacroInline> a compact run for a meal footer or a single row
 *
 * WHY THIS IS NOT A STACKED BAR
 * -----------------------------
 * The obvious design is a bar split into three, sitting under the calorie
 * meter. It would be a lie in two directions at once. Macros only exist for
 * ingredients that were weighed, so a day with a coffee and a restaurant dinner
 * in it has calories the bar cannot see; and 4P + 9F + 4C does not reconcile
 * with the calorie figure on real packet data anyway — rounding, fibre, alcohol
 * and the Atwater factors themselves put it a few per cent out. A bar drawn
 * beside the calorie meter asserts that the two describe the same whole.
 *
 * So this is text, and when it is describing only part of the day it says so.
 * The coverage note is not a disclaimer bolted on: it is the reason the numbers
 * above it can be trusted at all.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';

import type { MacroTotals } from '../../lib/derive';

/** One decimal, and none at all when it is a whole number. */
export function gramsLabel(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

const PARTS = [
  { key: 'protein', short: 'P', long: 'protein' },
  { key: 'fat', short: 'F', long: 'fat' },
  { key: 'carbs', short: 'C', long: 'carbs' },
] as const;

/** True when some of the calories in scope have no macros behind them. */
function isPartial(totals: MacroTotals): boolean {
  return totals.coveredKcal < totals.totalKcal;
}

function coverageNote(totals: MacroTotals): string {
  return `From ${totals.coveredKcal.toLocaleString()} of ${totals.totalKcal.toLocaleString()} kcal — the rest was not weighed`;
}

export interface MacroProps {
  totals: MacroTotals;
  className?: string;
}

/** The day's macros, laid out as three figures with a note about what they cover. */
export function MacroStrip({ totals, className }: MacroProps): JSX.Element {
  const partial = isPartial(totals);

  return (
    <div
      className={clsx(
        'flex flex-wrap items-baseline gap-x-5 gap-y-1.5',
        // A rule rather than a plate: this belongs to the meter above it, and a
        // tile here would read as a fifth figure competing with the four.
        'border-t border-[color:var(--pa-line-soft)] pt-3',
        className,
      )}
      aria-label="Macros"
    >
      {PARTS.map((part) => (
        <p key={part.key} className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tabular-nums text-[color:var(--pa-navy)]">
            {gramsLabel(totals.macros[part.key])}
          </span>
          <span className="text-[11px] leading-none text-[color:var(--pa-faint)]">
            g {part.long}
          </span>
        </p>
      ))}

      {partial ? (
        <p className="ml-auto text-[11px] leading-none text-[color:var(--pa-faint)]">
          {coverageNote(totals)}
        </p>
      ) : null}
    </div>
  );
}

/** The same numbers on one line, for a footer or a row. */
export function MacroInline({ totals, className }: MacroProps): JSX.Element {
  return (
    <span
      className={clsx('inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}
      data-tip={isPartial(totals) ? coverageNote(totals) : undefined}
    >
      {PARTS.map((part, index) => (
        <span key={part.key} className="inline-flex items-baseline gap-1">
          {index > 0 ? (
            <span className="text-[color:var(--pa-faint)]" aria-hidden>
              ·
            </span>
          ) : null}
          <span className="tabular-nums">{gramsLabel(totals.macros[part.key])}</span>
          <span aria-hidden>{part.short}</span>
          <span className="sr-only">g {part.long}</span>
        </span>
      ))}
      {isPartial(totals) ? (
        <span className="text-[color:var(--pa-faint)]">
          · {Math.round((totals.coveredKcal / Math.max(1, totals.totalKcal)) * 100)}% weighed
        </span>
      ) : null}
    </span>
  );
}
