'use client';

/* ---------------------------------------------------------------------------
 * brightness.ts — the screen dimmer, and the lift above it.
 *
 * A number the portal reads as "how bright", from 20 to 200, where 100 is the
 * page exactly as the browser drew it. Below that it is dimmed; above it, it is
 * brightened past what the page can manage on its own.
 *
 * ── Down: a black sheet ───────────────────────────────────────────────────
 * NOT a `filter: brightness()`. A filter on any ancestor creates a containing
 * block for `position: fixed` and silently kills `backdrop-filter` in the
 * subtree, and this portal is built out of both — the map stage is fixed, and
 * half the kit is frosted. So it is a black sheet over the top instead, at an
 * opacity of `(100 - brightness) / 100 × 0.85`.
 *
 * The ceiling is deliberate. A dimmer that reaches full black has a bottom end
 * you cannot recover from by looking harder, and this control is hidden —
 * somebody who dragged it to zero and let go would have to know the gesture to
 * get back. At 20 the portal is deeply dim and still legible.
 *
 * ── Up: a backdrop-filter sheet, on a CURVE ───────────────────────────────
 * Above 100 the same trick will not work: no amount of compositing an
 * ADDITIONAL layer over the page adds light, it can only take it away or wash
 * the whole thing toward white — a `screen` blend lifts the ink along with the
 * ground and turns black text grey, which is fog, not brightness.
 *
 * `backdrop-filter` on the sheet is the one way to reach what has already been
 * painted WITHOUT being an ancestor of it: no containing block changes, no
 * frosted panel below loses its own backdrop-filter, nothing about the layout
 * moves.
 *
 * But NOT `brightness()`. A multiply clips, and the dark theme's own text
 * sits at 0.91 luminance — so any multiplier past about 1.1 drives it into
 * pure white and takes its antialiasing with it. Measured at 2×: a third of
 * the pixels in a block of display type went to flat white and the region
 * dropped from 224 distinct tone levels to 171. The letters went chunky. That
 * is not a tuning problem, it is what a linear map does to a picture whose
 * highlights are already near the ceiling.
 *
 * So the sheet applies a GAMMA instead — `feComponentTransfer` with an
 * exponent of 0.7, which is the only kind of tone curve CSS can reach, since
 * every shorthand filter function is affine in the colour channels and none of
 * them can bend one. White stays white, black stays black, and everything
 * between lifts. Same brightness as the multiply on this page — ×1.98 mean
 * against ×1.92 — with nothing clipped at all and 207 of the 224 levels kept.
 *
 * The strength in between is the sheet's own `opacity`, which cross-fades the
 * filtered backdrop against the unfiltered one and cannot clip either, since
 * both ends are already in range.
 *
 * It is not free, and it is the reason the sheet only exists above 100: a
 * full-viewport backdrop-filter is a compositor pass over the whole screen. A
 * page nobody has pushed past neutral carries no layer at all.
 *
 * The honest trade: a gamma lifts the ink along with the ground, so text
 * contrast still falls as the slider climbs — just without the cliff. It costs
 * least where it is worth most, the dark theme, whose ground is nearly black
 * and has the most room to gain. The light theme barely moves and cannot: it
 * is already white, and nothing is brighter than white.
 *
 * Written as a store rather than React state, and shaped exactly like
 * `theme.ts`: same storage-event sync so two tabs agree, same
 * `useSyncExternalStore` hook, same pre-paint application from a blocking
 * script in the layout. That last one matters more here than it does for the
 * theme — this is a thing you reach for at night, and a flash of full
 * brightness before the effect runs is precisely what you turned it down to
 * avoid.
 * ------------------------------------------------------------------------- */

import { useSyncExternalStore } from 'react';

export const BRIGHTNESS_STORAGE_KEY = 'assistant.brightness.v1';

/** The page as the browser drew it — no sheet of either kind. */
export const BRIGHTNESS_NEUTRAL = 100;
/** Twice the luminance of neutral. */
export const BRIGHTNESS_MAX = 200;
/** As dim as it goes. Still readable; see the note above. */
export const BRIGHTNESS_MIN = 20;

/**
 * The notional opacity of the black sheet at a brightness of zero.
 *
 * Not the opacity at `BRIGHTNESS_MIN` — the curve is `(100 - b) / 100 × this`,
 * so the darkest the slider can actually reach is 20, giving 0.68.
 */
const MAX_DIM = 0.85;

export interface BrightnessControls {
  /** 20–200, with 100 meaning untouched. */
  brightness: number;
  /** False until storage has been read, so nothing renders a guess. */
  ready: boolean;
  setBrightness: (next: number) => void;
  /** True when the black sheet is doing anything at all. */
  dimmed: boolean;
  /** True when the page is being pushed past what it drew. */
  lifted: boolean;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return BRIGHTNESS_NEUTRAL;
  return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, Math.round(value)));
}

/**
 * The black sheet's opacity for a given brightness, or 0 at and above neutral.
 *
 * The divisor is `BRIGHTNESS_NEUTRAL` and not `BRIGHTNESS_MAX`: they used to be
 * the same number, and tying this curve to the top of the range would have
 * changed every setting below neutral the moment the range grew.
 */
export function dimFor(brightness: number): number {
  const value = clamp(brightness);
  if (value >= BRIGHTNESS_NEUTRAL) return 0;
  return ((BRIGHTNESS_NEUTRAL - value) / 100) * MAX_DIM;
}

/**
 * How much of the gamma curve to apply — 0 at and below neutral, 1 at the top.
 *
 * This is the sheet's OPACITY, not a multiplier. The curve itself is fixed (an
 * exponent of 0.7, in the SVG filter the layout ships); pulling the sheet's
 * opacity down cross-fades it against the unfiltered page underneath, which
 * gives a continuous strength without a second filter and without any risk of
 * clipping, since both ends of the fade are already in range.
 */
export function liftFor(brightness: number): number {
  const value = clamp(brightness);
  if (value <= BRIGHTNESS_NEUTRAL) return 0;
  return (value - BRIGHTNESS_NEUTRAL) / (BRIGHTNESS_MAX - BRIGHTNESS_NEUTRAL);
}

/* -------------------------------------------------------------------------
 * The store
 * ---------------------------------------------------------------------- */

let value = BRIGHTNESS_NEUTRAL;
let initialised = false;
let snapshot: { brightness: number; ready: boolean } = {
  brightness: BRIGHTNESS_NEUTRAL,
  ready: false,
};

/* A stable object for the server and the first client render. Returning a new
 * one each call would loop `useSyncExternalStore` forever. */
const SERVER_SNAPSHOT = { brightness: BRIGHTNESS_NEUTRAL, ready: false } as const;

const listeners = new Set<() => void>();

function readStored(): number {
  try {
    const raw = window.localStorage.getItem(BRIGHTNESS_STORAGE_KEY);
    return raw === null || raw === '' ? BRIGHTNESS_NEUTRAL : clamp(Number(raw));
  } catch {
    // Private mode, or storage disabled. Untouched is the safe default.
    return BRIGHTNESS_NEUTRAL;
  }
}

/**
 * Writes both sheets to the document.
 *
 * The attributes are REMOVED rather than set to a no-op value, so the rules
 * that paint the sheets do not match at all and there is no always-on
 * full-viewport layer for the compositor to carry when nobody is using one.
 * That matters most for the lift: its layer is a `backdrop-filter`, which is a
 * compositor pass over the entire viewport for as long as it exists.
 *
 * They are mutually exclusive by construction — both are zero on the wrong
 * side of neutral — but both are written every time so a value that crosses it
 * cannot leave the other one behind.
 */
function applyToDocument(brightness: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const dim = dimFor(brightness);
  if (dim > 0) {
    root.dataset.paDim = 'on';
    root.style.setProperty('--pa-dim', dim.toFixed(3));
  } else {
    delete root.dataset.paDim;
    root.style.removeProperty('--pa-dim');
  }

  const lift = liftFor(brightness);
  if (lift > 0) {
    root.dataset.paLift = 'on';
    root.style.setProperty('--pa-lift', lift.toFixed(3));
  } else {
    delete root.dataset.paLift;
    root.style.removeProperty('--pa-lift');
  }
}

function sync(): void {
  applyToDocument(value);
  if (snapshot.brightness === value && snapshot.ready === initialised) return;
  snapshot = { brightness: value, ready: initialised };
  for (const listener of Array.from(listeners)) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== BRIGHTNESS_STORAGE_KEY) return;
  value = event.newValue === null ? BRIGHTNESS_NEUTRAL : clamp(Number(event.newValue));
  sync();
}

function subscribe(listener: () => void): () => void {
  if (!initialised) {
    value = readStored();
    initialised = true;
    window.addEventListener('storage', onStorage);
    sync();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): { brightness: number; ready: boolean } {
  return snapshot;
}

function getServerSnapshot(): { brightness: number; ready: boolean } {
  return SERVER_SNAPSHOT;
}

function setBrightness(next: number): void {
  const clamped = clamp(next);
  if (clamped === value) return;
  value = clamped;
  try {
    window.localStorage.setItem(BRIGHTNESS_STORAGE_KEY, String(clamped));
  } catch {
    // Storage refused it; the choice still holds for this session.
  }
  sync();
}

export function useBrightness(): BrightnessControls {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    brightness: state.brightness,
    ready: state.ready,
    setBrightness,
    dimmed: state.brightness < BRIGHTNESS_NEUTRAL,
    lifted: state.brightness > BRIGHTNESS_NEUTRAL,
  };
}

/* -------------------------------------------------------------------------
 * The blocking init script
 * ---------------------------------------------------------------------- */

/**
 * Runs before first paint, from the layout.
 *
 * Duplicated verbatim into `layout.tsx` for the same reason `THEME_INIT_SCRIPT`
 * is: this module is `'use client'`, and a server component that imports from
 * one receives a proxy of client references rather than the value. Keep the
 * storage key, the bounds, the 0.85 ceiling and both attribute names in step
 * with the constants above — a drift shows up as a one-frame flash, not a
 * wrong setting.
 *
 * The empty-string and null cases are checked BEFORE the arithmetic and not
 * left to `isFinite`, because `Number(null)` is 0 rather than NaN: the guard
 * never caught it, the clamp pulled 0 up to the FLOOR of the range, and every
 * first visit painted at 68% black until React hydrated and put it right.
 *
 * `--pa-lift` is the sheet's OPACITY — 0 to 1 across the top half of the
 * range — not a multiplier. See `liftFor`.
 */
export const BRIGHTNESS_INIT_SCRIPT =
  `(function(){try{var v=null;try{v=window.localStorage.getItem("${BRIGHTNESS_STORAGE_KEY}");}catch(e){}` +
  `var n=(v===null||v==='')?100:Math.min(200,Math.max(20,Math.round(Number(v))));if(!isFinite(n)){n=100;}` +
  `var r=document.documentElement;` +
  `if(n<100){r.setAttribute('data-pa-dim','on');r.style.setProperty('--pa-dim',(((100-n)/100)*0.85).toFixed(3));}` +
  `else if(n>100){r.setAttribute('data-pa-lift','on');r.style.setProperty('--pa-lift',((n-100)/100).toFixed(3));}}catch(e){}})();`;
