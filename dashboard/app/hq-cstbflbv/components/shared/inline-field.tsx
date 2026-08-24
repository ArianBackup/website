'use client';

/* ---------------------------------------------------------------------------
 * InlineText / InlineNumber — writing straight onto the page.
 *
 * Both are a real `<input>` at all times, styled to read as plain text until it
 * is focused, at which point it grows a field. The alternative — a span that
 * swaps itself for an input on click — is the usual way this is built and it
 * brings a whole family of bugs with it: the first click lands on a span so the
 * caret goes to the start rather than where you aimed, focus has to be moved by
 * hand in an effect, and anything that re-renders mid-edit can swap the input
 * back out from under the caret. An input that is always an input has none of
 * that, and it costs one CSS class.
 *
 * ── Committing ────────────────────────────────────────────────────────────
 * On blur, or Enter. Not on keystroke: writing every character through to the
 * document would put one undo step in the stack per letter, so a single typo
 * would take four presses of ⌘Z to walk back past.
 *
 * Escape abandons. `abandonRef` exists because Escape blurs the field and the
 * blur handler would otherwise commit the very draft Escape meant to discard —
 * the two fire in that order and the flag is what tells them apart.
 * ------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

import { capitaliseOnType } from '../../lib/capitalise';

export interface InlineTextProps {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  /** Screen-reader name. */
  label: string;
  /** Empty commits are refused and the field snaps back. */
  required?: boolean;
  className?: string;
}

export function InlineText({
  value,
  onCommit,
  placeholder,
  label,
  required = true,
  className,
}: InlineTextProps): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const abandonRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // A change from elsewhere (undo, another tab) shows up — unless this field is
  // the thing being typed into right now.
  useEffect(() => {
    if (draft === null) return;
    if (document.activeElement !== inputRef.current) setDraft(null);
  }, [value, draft]);

  const commit = (): void => {
    const raw = draft;
    setDraft(null);
    if (abandonRef.current) {
      abandonRef.current = false;
      return;
    }
    if (raw === null) return;
    const next = raw.trim();
    if (required && next.length === 0) return;
    if (next === value.trim()) return;
    onCommit(next);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft ?? value}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => setDraft(capitaliseOnType(event))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          abandonRef.current = true;
          event.currentTarget.blur();
        }
      }}
      className={clsx('pa-ghost pa-focus', className)}
    />
  );
}

export interface InlineNumberProps {
  value: number;
  onCommit: (next: number) => void;
  min?: number;
  max?: number;
  /** Rendered after the number, inside the field's own box. */
  suffix?: string;
  /**
   * Decimal places kept on commit. 0 — the default, and every calorie figure in
   * the portal — makes the field integer-only. Packet facts need 1: "3.6 g of
   * fat per 100 g" truncated to 3 is a tenth of the number wrong on olive oil.
   */
  precision?: number;
  label: string;
  className?: string;
}

/**
 * The same idea for a figure — used for the calorie target and for the kcal on
 * each entry, where a stepper would be wrong: nobody nudges 650 kcal up in
 * increments, they know the number and type it.
 */
export function InlineNumber({
  value,
  onCommit,
  min = 0,
  max = 100_000,
  suffix,
  precision = 0,
  label,
  className,
}: InlineNumberProps): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const abandonRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (draft === null) return;
    if (document.activeElement !== inputRef.current) setDraft(null);
  }, [value, draft]);

  const commit = (): void => {
    const raw = draft;
    setDraft(null);
    if (abandonRef.current) {
      abandonRef.current = false;
      return;
    }
    if (raw === null) return;
    const trimmed = raw.trim();
    // Thousands separators are how these numbers are READ, so they have to be
    // accepted when they are typed back in.
    const parsed = trimmed.length === 0 ? min : Number(trimmed.replace(/[\s,]/g, ''));
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    const factor = 10 ** precision;
    const next = precision === 0 ? Math.trunc(clamped) : Math.round(clamped * factor) / factor;
    if (next === value) return;
    onCommit(next);
  };

  // Idle, the number is grouped for reading; being edited, it is exactly what
  // was typed — regrouping under the caret would move it.
  const shown = draft ?? value.toLocaleString();

  return (
    <span className={clsx('pa-ghost-num', className)}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={shown}
        aria-label={label}
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
          }
        }}
        /* Sized from the content so the field is exactly as wide as its number
         * — a fixed width would leave "0" floating in a box built for "12,345".
         *
         * In `ch` rather than via the `size` attribute: browsers pad `size` by
         * roughly a character and a half, which left a visible gap between the
         * figure and its unit. Callers set `tabular-nums`, so every digit is
         * one `ch` exactly; the separators are narrower, hence the small
         * negative allowance per comma rather than a flat fudge. */
        style={{ width: `${shown.length - (shown.match(/[,\s.]/g)?.length ?? 0) * 0.45}ch` }}
        className="pa-ghost pa-focus"
      />
      {suffix ? <span className="pa-ghost-suffix">{suffix}</span> : null}
    </span>
  );
}
