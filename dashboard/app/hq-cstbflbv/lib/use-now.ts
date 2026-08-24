'use client';

/* ---------------------------------------------------------------------------
 * use-now.ts — the portal's heartbeat.
 *
 * One hook, `useNow(intervalMs)`, returns a `Date` that updates on a schedule.
 * It is what makes the big clock tick and what rolls the whole app over to the
 * next day at midnight without a reload.
 *
 * Three things make it worth more than a `setInterval` in a component:
 *
 *   1. IT IS SHARED. Every caller asking for the same interval subscribes to
 *      the SAME timer and reads the SAME `Date` object, so ten components
 *      ticking at 1s cost one timer and re-render in the same frame — they can
 *      never disagree about what time it is by a few milliseconds.
 *
 *   2. IT IS ALIGNED. Ticks are scheduled to the next boundary on the epoch
 *      grid rather than "now + interval", so a 1s clock changes on the whole
 *      second and a 60s clock on the exact top of the minute. Each tick
 *      recomputes the next delay from `Date.now()`, so drift cannot accumulate
 *      and a laptop waking from sleep re-syncs on its first tick.
 *
 *   3. IT IS SSR-SAFE. `useSyncExternalStore` hands React a fixed sentinel
 *      during server render and hydration, so the first client render matches
 *      the server byte for byte; the real clock starts in the subscribe effect
 *      immediately afterwards. Anything that renders a time should ask
 *      `isClockPlaceholder()` first rather than print the sentinel.
 *
 * The timer also stands down while the tab is hidden — a background tab has no
 * clock to look at — and catches up the moment it comes back.
 * ------------------------------------------------------------------------- */

import { useCallback, useSyncExternalStore } from 'react';

type Listener = () => void;

interface SharedClock {
  /** Tick length in ms. Also this clock's key in `clocks`. */
  readonly interval: number;
  /** The cached snapshot. Replaced on a tick, never on a read. */
  now: Date;
  readonly listeners: Set<Listener>;
  timer: ReturnType<typeof setTimeout> | null;
  onVisibility: (() => void) | null;
}

/** One clock per distinct interval, created lazily, dropped when unused. */
const clocks = new Map<number, SharedClock>();

/**
 * The value every render sees before the clock starts: the epoch.
 *
 * It has to be a constant, because React renders it on the server AND again on
 * the client during hydration — anything derived from the real clock would
 * differ between the two and blow up hydration. Never mutate it, and never
 * print it: `isClockPlaceholder()` exists so a surface can render a blank
 * instead of claiming it is midnight in 1970 for one frame.
 */
const SSR_NOW = new Date(0);

const DEFAULT_INTERVAL = 1000;
const MIN_INTERVAL = 50;

/** A few ms of slack so a timer that fires a hair early still lands after the
 *  boundary — otherwise a 1s clock can show the same second twice. */
const BOUNDARY_PADDING = 8;

function normaliseInterval(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_INTERVAL;
  return Math.max(MIN_INTERVAL, Math.floor(ms));
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function getClock(interval: number): SharedClock {
  const existing = clocks.get(interval);
  if (existing) return existing;

  const created: SharedClock = {
    interval,
    // A clock created during render starts from the real time, so a component
    // mounting long after hydration is never a tick behind.
    now: typeof window === 'undefined' ? SSR_NOW : new Date(),
    listeners: new Set(),
    timer: null,
    onVisibility: null,
  };
  clocks.set(interval, created);
  return created;
}

/** Moves the snapshot on — but only when the reading actually changed slot, so
 *  a wake-up inside the current slot does not re-render the tree for nothing. */
function tick(clock: SharedClock): void {
  const next = new Date();
  const nextSlot = Math.floor(next.getTime() / clock.interval);
  const currentSlot = Math.floor(clock.now.getTime() / clock.interval);
  if (nextSlot === currentSlot) return;

  clock.now = next;
  // Copy first: a listener may unsubscribe while we are notifying.
  for (const listener of Array.from(clock.listeners)) listener();
}

function clearTimer(clock: SharedClock): void {
  if (clock.timer === null) return;
  clearTimeout(clock.timer);
  clock.timer = null;
}

/** Queues the next tick on the epoch grid. Idle while hidden or unsubscribed. */
function schedule(clock: SharedClock): void {
  clearTimer(clock);
  if (clock.listeners.size === 0 || documentHidden()) return;

  const delay = clock.interval - (Date.now() % clock.interval) + BOUNDARY_PADDING;
  clock.timer = setTimeout(() => {
    clock.timer = null;
    tick(clock);
    schedule(clock);
  }, delay);
}

function subscribe(interval: number, listener: Listener): () => void {
  const clock = getClock(interval);
  const first = clock.listeners.size === 0;
  clock.listeners.add(listener);

  if (first) {
    if (typeof document !== 'undefined') {
      const onVisibility = (): void => {
        if (document.visibilityState === 'hidden') {
          clearTimer(clock);
          return;
        }
        // Back in view: catch up before resuming the schedule.
        tick(clock);
        schedule(clock);
      };
      clock.onVisibility = onVisibility;
      document.addEventListener('visibilitychange', onVisibility);
    }
    tick(clock);
    schedule(clock);
  }

  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size > 0) return;

    clearTimer(clock);
    if (clock.onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', clock.onVisibility);
    }
    clock.onVisibility = null;
    // Dropped rather than parked, so the next mount reads a fresh time instead
    // of whatever this clock happened to freeze on.
    clocks.delete(interval);
  };
}

function getServerSnapshot(): Date {
  return SSR_NOW;
}

/**
 * True while `value` is the SSR sentinel rather than a real reading — i.e. on
 * the server and for the single hydration render. Surfaces that print a time
 * should show a blank until this is `false`.
 */
export function isClockPlaceholder(value: Date): boolean {
  return value.getTime() === SSR_NOW.getTime();
}

/**
 * A `Date` that updates every `intervalMs` (default 1000).
 *
 * Pick the coarsest interval the surface can live with: `1000` for a seconds
 * display, `60_000` for anything that only shows minutes or watches for the day
 * to roll over — aligned ticks mean a 60s clock still flips exactly on the
 * minute boundary while doing a sixtieth of the work.
 */
export function useNow(intervalMs: number = DEFAULT_INTERVAL): Date {
  const interval = normaliseInterval(intervalMs);

  const subscribeToClock = useCallback(
    (listener: Listener) => subscribe(interval, listener),
    [interval],
  );

  const getSnapshot = useCallback(() => getClock(interval).now, [interval]);

  return useSyncExternalStore(subscribeToClock, getSnapshot, getServerSnapshot);
}
