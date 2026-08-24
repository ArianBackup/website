/* ---------------------------------------------------------------------------
 * dates.ts — every date the assistant touches, in LOCAL time.
 *
 * The whole app keys days by `'yyyy-MM-dd'` strings produced here. We never use
 * `toISOString().slice(0, 10)`: that formats in UTC and silently shifts the day
 * for anyone east or west of Greenwich (a task added at 9pm in Sydney would
 * land on tomorrow, one added at 1am in New York on yesterday).
 *
 * Weeks start on MONDAY everywhere.
 * ------------------------------------------------------------------------- */

import {
  addDays,
  differenceInCalendarDays,
  format,
  getISODay,
  isValid,
  parse as parseDate,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import type { DayKey } from './types';

/** The one true day-key format. */
const KEY_FORMAT = 'yyyy-MM-dd';

/** Monday. Used for every week boundary in the product. */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/** Formats a `Date` as a local `DayKey`. */
export function toKey(d: Date): DayKey {
  return format(d, KEY_FORMAT);
}

/** Today, in the viewer's own timezone. */
export function todayKey(): DayKey {
  return toKey(new Date());
}

/**
 * Parses a `DayKey` back into a local `Date` at midnight.
 * Malformed input falls back to today rather than producing an Invalid Date —
 * every caller downstream treats the result as a real day.
 */
export function fromKey(k: DayKey): Date {
  const parsed = parseDate(k, KEY_FORMAT, new Date());
  if (!isValid(parsed)) return startOfDay(new Date());
  return startOfDay(parsed);
}

/** Shifts a key by `n` days (negative goes back). DST-safe via date-fns. */
export function addDaysKey(k: DayKey, n: number): DayKey {
  return toKey(addDays(fromKey(k), n));
}

/** The Monday of the week that `k` falls in. Defaults to this week. */
export function weekStartKey(k: DayKey = todayKey()): DayKey {
  return toKey(startOfWeek(fromKey(k), WEEK_OPTIONS));
}

/** The seven keys Mon…Sun of the week starting at `mondayKey`. */
export function weekDaysFrom(mondayKey: DayKey): DayKey[] {
  const keys: DayKey[] = [];
  for (let i = 0; i < 7; i += 1) keys.push(addDaysKey(mondayKey, i));
  return keys;
}

/** The last `n` days ascending, inclusive of `endKey` (defaults to today). */
export function lastNDays(n: number, endKey: DayKey = todayKey()): DayKey[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  const count = Math.floor(n);
  const keys: DayKey[] = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(addDaysKey(endKey, -i));
  return keys;
}

/** `date-fns` format applied to a day key, e.g. `formatKey(k, 'EEE d MMM')`. */
export function formatKey(k: DayKey, fmt: string): string {
  return format(fromKey(k), fmt);
}

/**
 * Calendar days from `a` to `b`. Positive when `b` is later than `a`,
 * negative when it is earlier. Time of day never enters into it.
 */
export function daysBetween(a: DayKey, b: DayKey): number {
  return differenceInCalendarDays(fromKey(b), fromKey(a));
}

/** `'Today' | 'Tomorrow' | 'Yesterday' | 'Mon 4 Aug'`. */
export function relativeDayLabel(k: DayKey, refKey: DayKey = todayKey()): string {
  const delta = daysBetween(refKey, k);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  return formatKey(k, 'EEE d MMM');
}

/* Day keys are fixed-width and zero-padded, so lexicographic order is calendar
 * order — the comparisons below need no parsing at all. */

export function isToday(k: DayKey, refKey: DayKey = todayKey()): boolean {
  return k === refKey;
}

export function isPastDay(k: DayKey, refKey: DayKey = todayKey()): boolean {
  return k < refKey;
}

export function isFutureDay(k: DayKey, refKey: DayKey = todayKey()): boolean {
  return k > refKey;
}

/** ISO weekday number: 1 = Monday … 7 = Sunday. */
export function isoWeekday(k: DayKey): number {
  return getISODay(fromKey(k));
}

/** `'Mon'`. */
export function weekdayShort(k: DayKey): string {
  return formatKey(k, 'EEE');
}

/** `'4'` — the day of the month, unpadded. */
export function dayNumber(k: DayKey): string {
  return formatKey(k, 'd');
}
