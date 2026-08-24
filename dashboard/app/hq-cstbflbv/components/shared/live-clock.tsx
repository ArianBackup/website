'use client';

/* ---------------------------------------------------------------------------
 * LiveClock — the time, treated as a piece of the design rather than a readout.
 *
 * Two variants off one component:
 *
 *   hero     the top of the Today view. Big numerals, date underneath.
 *   compact  an inline HH:MM for the header chrome.
 *
 * Always 12-hour, and deliberately without a seconds readout: a second number
 * ticking beside the time competes with it for attention.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY DIGIT IS ITS OWN CELL
 *
 * A clock that re-renders one string flickers: the whole line repaints every
 * second even though a single glyph moved. Here each numeral is a fixed-width
 * cell with its own <AnimatePresence>, keyed on the digit's VALUE — so only the
 * cells that actually changed animate. The outgoing numeral slides up and out,
 * the incoming one rises from below, and the cell clips both.
 *
 * The cells are sized in `ch` and the type is tabular, so a `1` is exactly as
 * wide as an `8` and nothing shifts as the time moves. Each cell also carries
 * an explicit height in `em` with `line-height: 1`, which keeps every cell —
 * digits, colons, both variants — on the same optical baseline regardless of
 * the font's own metrics.
 *
 * Memoisation matters here more than usual: this subtree is asked to re-render
 * 3,600 times an hour. `Digit`, `DigitGroup` and `ClockCaption` are all memo'd
 * on plain values, so a tick that only moves the seconds does not touch the
 * hours, the minutes or the date line at all.
 * ------------------------------------------------------------------------- */

import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { format } from 'date-fns';

import { isClockPlaceholder, useNow } from '../../lib/use-now';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;
const ROLL_DURATION = 0.42;
const FADE_DURATION = 0.18;

/** A blank the width of a numeral. Shown instead of a fake time before the
 *  clock is live — never "00:00", which reads as a real reading. */
const BLANK_DIGIT = ' ';

/**
 * The shared cell box. `inline-flex` centring (rather than the class's default
 * `inline-block`) is what makes the glyph sit in the middle of the box no
 * matter what the font's ascent and descent are, so mixed sizes still line up.
 */
const DIGIT_CELL: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1ch',
  height: '1.15em',
  lineHeight: 1,
  letterSpacing: 'normal',
};

/** Same box, narrower — a colon needs nothing like a numeral's width. */
const SEPARATOR_CELL: CSSProperties = { ...DIGIT_CELL, width: '0.5ch' };

/* The hero's numerals, and the two smaller elements that sit beside them. */
const HERO_TIME: CSSProperties = {
  alignItems: 'flex-end',
  fontSize: 'clamp(2.75rem, 7vw, 4.25rem)',
};
/* `em` on margin resolves against the element's OWN size, hence 0.75 of a very
 * small element rather than a fraction of the hero. */
const HERO_MERIDIEM: CSSProperties = { fontSize: '0.2em', marginLeft: '0.75em' };

const COMPACT_TIME: CSSProperties = { alignItems: 'flex-end' };
const COMPACT_SECONDS: CSSProperties = { fontSize: '0.78em' };
const COMPACT_MERIDIEM: CSSProperties = { fontSize: '0.62em', marginLeft: '0.5em' };

export interface LiveClockProps {
  /** `hero` for the Today masthead, `compact` for inline chrome. */
  variant?: 'hero' | 'compact';
  /** Defaults to true for `hero` (inside the arc) and false for `compact`. */
  showSeconds?: boolean;
  className?: string;
}

/* -------------------------------------------------------------------------
 * Time → parts
 * ---------------------------------------------------------------------- */

interface ClockParts {
  hours: string;
  minutes: string;
  seconds: string;
  /** `''` in a 24-hour locale. */
  meridiem: string;
  secondsValue: number;
  /** Local `<time datetime>` value, `''` before the clock is live. */
  iso: string;
  /** What a screen reader hears, e.g. `9:41 AM`. */
  readable: string;
}

const PLACEHOLDER_PARTS: ClockParts = {
  hours: `${BLANK_DIGIT}${BLANK_DIGIT}`,
  minutes: `${BLANK_DIGIT}${BLANK_DIGIT}`,
  seconds: `${BLANK_DIGIT}${BLANK_DIGIT}`,
  meridiem: '',
  secondsValue: 0,
  iso: '',
  readable: '',
};

/* Always 12-hour, by the owner's choice — not the browser's locale. A personal
 * dashboard reads the way its owner reads a clock, and a 24-hour fallback on a
 * differently-configured machine would be a surprise, not a convenience. */
function resolveHour12(): boolean {
  return true;
}

function clockParts(now: Date, hour12: boolean, live: boolean): ClockParts {
  if (!live) return PLACEHOLDER_PARTS;

  const hours24 = now.getHours();
  const shown = hour12 ? hours24 % 12 || 12 : hours24;

  return {
    // A 12-hour clock reads "9:41", not "09:41"; a 24-hour one is always padded.
    hours: hour12 ? String(shown) : String(shown).padStart(2, '0'),
    minutes: String(now.getMinutes()).padStart(2, '0'),
    seconds: String(now.getSeconds()).padStart(2, '0'),
    meridiem: hour12 ? (hours24 < 12 ? 'AM' : 'PM') : '',
    secondsValue: now.getSeconds(),
    iso: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
    readable: format(now, hour12 ? 'h:mm a' : 'HH:mm'),
  };
}

/* -------------------------------------------------------------------------
 * Digits
 * ---------------------------------------------------------------------- */

interface DigitProps {
  digit: string;
  reduce: boolean;
}

const Digit = memo(function Digit({ digit, reduce }: DigitProps): JSX.Element {
  return (
    <span className="pa-clock-digit" style={DIGIT_CELL}>
      {/* popLayout takes the outgoing numeral out of flow so the incoming one
          can take the cell immediately — without it the two would sit side by
          side for the length of the animation and the clock would stretch. */}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={digit}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: '60%' }}
          animate={{ opacity: 1, y: '0%' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: '-60%' }}
          transition={{ duration: reduce ? FADE_DURATION : ROLL_DURATION, ease: HOUSE_EASE }}
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  );
});

interface DigitGroupProps {
  /** Already formatted — `'09'`, `'41'`, `'7'`. */
  value: string;
  reduce: boolean;
  className?: string;
  /** Module-level constants only: a fresh object would defeat the memo. */
  style?: CSSProperties;
}

const DigitGroup = memo(function DigitGroup({
  value,
  reduce,
  className,
  style,
}: DigitGroupProps): JSX.Element {
  const digits = useMemo(() => value.split(''), [value]);

  return (
    <span className={clsx('inline-flex', className)} style={style} aria-hidden="true">
      {digits.map((digit, index) => (
        // Position-keyed on purpose: the cell is the stable thing, the digit
        // inside it is what animates.
        <Digit key={index} digit={digit} reduce={reduce} />
      ))}
    </span>
  );
});

function Separator({ style = SEPARATOR_CELL }: { style?: CSSProperties }): JSX.Element {
  return (
    <span className="pa-clock-sep" style={style} aria-hidden="true">
      :
    </span>
  );
}
/* -------------------------------------------------------------------------
 * Caption
 * ---------------------------------------------------------------------- */

interface ClockCaptionProps {
  dateLabel: string;
}

const ClockCaption = memo(function ClockCaption({ dateLabel }: ClockCaptionProps): JSX.Element {
  return (
    <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-snug text-[color:var(--pa-muted)]">
      <span className="font-medium text-[color:var(--pa-navy)]">{dateLabel}</span>
    </p>
  );
});

/* -------------------------------------------------------------------------
 * LiveClock
 * ---------------------------------------------------------------------- */

export function LiveClock({
  variant = 'hero',
  showSeconds,
  className,
}: LiveClockProps): JSX.Element {
  const reduce = useReducedMotion() ?? false;
  const hero = variant === 'hero';
  const withSeconds = showSeconds ?? hero;

  /* The hero's arc needs every second. A minute-only clock ticks at 60s — and
   * because ticks are aligned to the epoch grid it still flips exactly on the
   * boundary, for a sixtieth of the work. */
  const now = useNow(hero || withSeconds ? 1000 : 60_000);
  const live = !isClockPlaceholder(now);

  const hour12 = useMemo(resolveHour12, []);
  const parts = useMemo(() => clockParts(now, hour12, live), [now, hour12, live]);

  /* Both recompute on every tick and both are cheap; `ClockCaption` is memo'd
   * on the resulting strings, so the DOM is only touched when they change. */
  const dateLabel = live ? format(now, 'EEEE, d MMMM') : '';

  if (!hero) {
    return (
      <time
        dateTime={parts.iso || undefined}
        className={clsx('pa-clock text-[15px] text-[color:var(--pa-navy)]', className)}
        style={COMPACT_TIME}
      >
        {live ? <span className="sr-only">{parts.readable}</span> : null}

        <DigitGroup value={parts.hours} reduce={reduce} />
        <Separator />
        <DigitGroup value={parts.minutes} reduce={reduce} />

        {withSeconds ? (
          <>
            <Separator />
            <DigitGroup
              value={parts.seconds}
              reduce={reduce}
              className="text-[color:var(--pa-faint)]"
              style={COMPACT_SECONDS}
            />
          </>
        ) : null}

        {parts.meridiem ? (
          <span
            className="self-center uppercase tracking-[0.14em] text-[color:var(--pa-faint)]"
            style={COMPACT_MERIDIEM}
            aria-hidden="true"
          >
            {parts.meridiem}
          </span>
        ) : null}
      </time>
    );
  }

  return (
    <div className={clsx('flex items-center', className)}>
      <div className="min-w-0">
        <time dateTime={parts.iso || undefined} className="pa-clock pa-display" style={HERO_TIME}>
          {live ? <span className="sr-only">{parts.readable}</span> : null}

          <DigitGroup value={parts.hours} reduce={reduce} />
          <Separator />
          <DigitGroup value={parts.minutes} reduce={reduce} />

          {parts.meridiem ? (
            <span
              className="self-center uppercase tracking-[0.18em] text-[color:var(--pa-faint)]"
              style={HERO_MERIDIEM}
              aria-hidden="true"
            >
              {parts.meridiem}
            </span>
          ) : null}
        </time>

        {live ? (
          <ClockCaption dateLabel={dateLabel} />
        ) : (
          /* Holds the caption's height so nothing reflows when the clock
             starts. */
          <p className="mt-2.5 h-[18px]" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
