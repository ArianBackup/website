'use client';

/* ---------------------------------------------------------------------------
 * NumberStepper — the counter.
 *
 * A minus, a number you can also just type into, and a plus. Used for the load
 * on an exercise and for sets and reps beside it.
 *
 * ── Why the middle is a real input ─────────────────────────────────────────
 * Steppers that are ONLY buttons are fine for 3 → 4 and miserable for 20 → 100.
 * Steppers that are only a field make you select-all-and-retype to add 2.5 kg,
 * which is the single most common edit there is. It is both: the buttons move
 * by one plate, the field takes a number straight.
 *
 * ── Committing ────────────────────────────────────────────────────────────
 * The buttons commit immediately — there is nothing ambiguous about a press.
 * Typing commits on blur or Enter, and NOT on every keystroke: mid-edit a field
 * legitimately reads "" or "1" on the way to "125", and writing those through
 * would put a zero in the document and, worse, a zero in the undo stack for
 * every character typed. Escape abandons and restores what was there.
 *
 * The draft is held as a string, so a half-typed "12." survives until it is
 * either finished or thrown away — parsing on each keystroke would delete the
 * decimal point out from under the caret.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { clsx } from 'clsx';
import { Minus, Plus } from 'lucide-react';

export interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places kept when committing. 0 makes the field integer-only. */
  precision?: number;
  /** Rendered inside the field's box, after the number. */
  suffix?: string;
  /** Screen-reader name — the visible label is usually a column heading. */
  label: string;
  /** Width of the number box in `ch`, so it fits the range it will hold. */
  width?: number;
  size?: 'sm' | 'md';
  className?: string;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function NumberStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
  precision = 0,
  suffix,
  label,
  width = 3,
  size = 'md',
  className,
}: NumberStepperProps): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const abandonRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* An edit landing from anywhere else — undo, another tab, a copied session —
   * has to show up here. It must not stomp on a draft mid-type, so this only
   * runs while the field is idle. */
  useEffect(() => {
    if (draft === null) return;
    if (document.activeElement !== inputRef.current) setDraft(null);
  }, [value, draft]);

  const clamp = useCallback(
    (next: number): number => {
      if (!Number.isFinite(next)) return min;
      return round(Math.min(max, Math.max(min, next)), precision);
    },
    [max, min, precision],
  );

  const nudge = useCallback(
    (direction: 1 | -1): void => {
      const next = clamp(value + direction * step);
      if (next !== value) onChange(next);
    },
    [clamp, onChange, step, value],
  );

  const commit = useCallback((): void => {
    const raw = draft;
    setDraft(null);
    if (abandonRef.current) {
      abandonRef.current = false;
      return;
    }
    if (raw === null) return;
    const trimmed = raw.trim();
    // An emptied field means "zero", not "delete the row" — but only if zero is
    // reachable; otherwise it snaps back to the floor.
    const parsed = trimmed.length === 0 ? min : Number(trimmed.replace(',', '.'));
    if (Number.isNaN(parsed)) return;
    const next = clamp(parsed);
    if (next !== value) onChange(next);
  }, [clamp, draft, min, onChange, value]);

  const shown = draft ?? String(value);
  const atMin = value <= min;
  const atMax = value >= max;

  const box: CSSProperties = { width: `${width}ch` };
  const compact = size === 'sm';

  return (
    <div
      className={clsx('pa-step', compact && 'pa-step-sm', className)}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className="pa-step-btn pa-focus"
        onClick={() => nudge(-1)}
        disabled={atMin}
        aria-label={`Decrease ${label}`}
        data-tip={`−${step}`}
        tabIndex={-1}
      >
        <Minus className={compact ? 'size-3' : 'size-3.5'} strokeWidth={2.5} aria-hidden />
      </button>

      <label className="pa-step-field">
        <span className="sr-only">{label}</span>

        {/* A hidden mirror of the unit, on the other side.
            Without it the field centres the NUMBER AND ITS UNIT as a pair, so
            the digits sit off to the left — measured at 6.7px on the load
            counter, which is plainly visible against the two buttons either
            side of it. Reserving the same width on both sides puts the number
            itself dead centre, and it does so for any unit at any font size
            without a magic offset to keep in step. */}
        {suffix ? (
          <span className="pa-step-suffix" aria-hidden style={{ visibility: 'hidden' }}>
            {suffix}
          </span>
        ) : null}

        <input
          ref={inputRef}
          // `text` with a numeric keypad, not `number`: type=number swallows a
          // scroll over the field as a value change, and its spinners are a
          // second, uglier stepper sitting inside this one.
          type="text"
          inputMode="decimal"
          value={shown}
          style={box}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              abandonRef.current = true;
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              nudge(1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              nudge(-1);
            }
          }}
          className="pa-step-input"
        />
        {suffix ? (
          <span className="pa-step-suffix" aria-hidden>
            {suffix}
          </span>
        ) : null}
      </label>

      <button
        type="button"
        className="pa-step-btn pa-focus"
        onClick={() => nudge(1)}
        disabled={atMax}
        aria-label={`Increase ${label}`}
        data-tip={`+${step}`}
        tabIndex={-1}
      >
        <Plus className={compact ? 'size-3' : 'size-3.5'} strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  );
}
