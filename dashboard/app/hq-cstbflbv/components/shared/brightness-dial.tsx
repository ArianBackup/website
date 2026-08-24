'use client';

/* ---------------------------------------------------------------------------
 * brightness-dial.tsx — the dimmer, and the gesture that finds it.
 *
 * WHERE IT HIDES
 * --------------
 * Nowhere on the page. It is behind a long press on the theme toggle, which is
 * the one control it belongs beside: everything about how bright this thing is
 * lives in that pill. On a desktop `Shift + B` opens it too, because a long
 * press with a mouse is a gesture nobody performs by accident and therefore
 * one nobody performs on purpose either.
 *
 * A long press and not a double tap: a double tap on a segmented control is
 * two theme changes, and 300ms of "did that do anything" while the browser
 * waits to find out. The press threshold is 450ms, and the toggle's own click
 * is suppressed for exactly one event afterwards so the theme does not flip
 * on the way out of the gesture.
 *
 * WHAT IT DRAWS
 * -------------
 * A real `<input type="range">` under a custom skin — so it arrives with
 * keyboard support, the arrow keys, Home/End, a proper `aria-valuetext`, and
 * the platform's own drag handling on touch. The skin is `.pa-slider` in
 * assistant.css; the fill is a gradient driven by `--pa-fill`, which is the
 * only thing this component writes per frame.
 *
 * The scale runs 20 to 200 with a notch at 100. Left of the notch a black
 * sheet takes light away; right of it a backdrop-filter bends a gamma curve
 * over what is already painted, reaching twice the brightness the page can
 * manage on its own without clipping a single pixel to white.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Sun, SunDim } from 'lucide-react';

import { PORTAL_SHELL } from './dialog-chrome';

import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  BRIGHTNESS_NEUTRAL,
  useBrightness,
} from '../../lib/brightness';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** How long a press has to last before it counts as one. */
const PRESS_MS = 450;

/* -------------------------------------------------------------------------
 * The gesture
 * ---------------------------------------------------------------------- */

export interface LongPressHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/**
 * A long press that does not fight the click underneath it.
 *
 * `suppress` is the whole trick. A press that fires still ends in a
 * `pointerup` and therefore a `click`, and the element this is attached to is
 * a theme button — so without it, revealing the dimmer would also change the
 * theme. The flag swallows exactly one click and then clears itself.
 *
 * `onContextMenu` is prevented while pressing because a long press on touch is
 * also the browser's own "select/copy" gesture, and on desktop it is the
 * right-click menu.
 */
export function useLongPress(onFire: () => void): {
  handlers: LongPressHandlers;
  shouldSuppressClick: () => boolean;
} {
  const timer = useRef<number | null>(null);
  const suppress = useRef(false);

  const clear = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  return {
    handlers: {
      onPointerDown: (event) => {
        // Primary button only; a right-click already has its own meaning.
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        clear();
        timer.current = window.setTimeout(() => {
          suppress.current = true;
          onFire();
        }, PRESS_MS);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (event) => {
        if (timer.current !== null || suppress.current) event.preventDefault();
      },
    },
    shouldSuppressClick: () => {
      if (!suppress.current) return false;
      suppress.current = false;
      return true;
    },
  };
}

/* -------------------------------------------------------------------------
 * The sheets
 * ---------------------------------------------------------------------- */

/**
 * Nothing. Both are painted in assistant.css off the attributes the store
 * writes: `html[data-pa-dim]::after` is the black sheet below neutral, and
 * `html[data-pa-lift]::before` is the gamma-curve backdrop-filter above it.
 *
 * They live in CSS rather than in a React portal for two reasons: they have to
 * be above dialogs and toasts, which portal to `<body>` and would out-stack
 * any element the portal's own tree could produce; and they have to exist
 * before React does, from the blocking init script, or opening the portal at
 * night flashes the screen at full brightness first.
 */

/* -------------------------------------------------------------------------
 * The dial
 * ---------------------------------------------------------------------- */

export interface BrightnessDialProps {
  open: boolean;
  onClose: () => void;
  /** Anchored under this element. */
  anchorRef: React.RefObject<HTMLElement>;
}

export function BrightnessDial({ open, onClose, anchorRef }: BrightnessDialProps): JSX.Element | null {
  const { brightness, setBrightness, lifted } = useBrightness();
  const reduce = useReducedMotion();
  const id = useId();

  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Measured on open and on every scroll or resize while open. `position:
   * fixed` against viewport coordinates, so the panel cannot be clipped by a
   * `overflow: clip` ancestor — and the shell IS one. */
  useEffect(() => {
    if (!open) return;
    const place = (): void => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 244;
      const left = Math.min(
        Math.max(12, r.left + r.width / 2 - width / 2),
        window.innerWidth - width - 12,
      );
      setBox({ top: r.bottom + 10, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef]);

  /* Focus the slider on open so the arrow keys work immediately, and so a
   * screen reader lands on the thing that just appeared. */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onDown = (event: PointerEvent): void => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      const target = event.target as Node;
      if (panel?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Capture, so a click on something that stops propagation still dismisses.
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, onClose, anchorRef]);

  if (typeof document === 'undefined') return null;

  const along = (value: number): number =>
    ((value - BRIGHTNESS_MIN) / (BRIGHTNESS_MAX - BRIGHTNESS_MIN)) * 100;

  const pct = along(brightness);
  /* Where 100 falls on the track — the point the page is untouched, and the
   * line between undoing a dim and pushing past what the page can do. The
   * stylesheet draws a notch there. */
  const neutral = along(BRIGHTNESS_NEUTRAL);

  /* Three elements, not one, and the nesting is the whole point.
   `.assistant-shell` is the PAGE: `position: relative`, `min-height:
   100svh`, `overflow-x: clip`, `background: transparent`. Put it on
   the panel itself and all of that comes with it — the first version
   of this was 244×664, static in the document flow five thousand
   pixels down, and transparent, because `.assistant-shell` at (0,1,0)
   beat the `fixed` utility and the `.pa-sheet` fill.

   So: a positioned wrapper on the outside, the shell in the middle
   neutralised by `PORTAL_SHELL` exactly as every dialog does it, and
   `.pa-sheet` on the inside where it can be the surface. Positioning
   is inline so no specificity fight is possible.

   The z-index on the wrapper does NOT lift this above the two
   brightness sheets, and it cannot: `body` carries `isolation:
   isolate`, which makes it a stacking context, so every z-index in
   this tree is scoped inside it while the sheets hang off `html` and
   paint over the whole thing. 2147483001 buys position against the
   dialogs and the toasts, which is all it was ever going to.

   Measured, not assumed: the panel tracks the page exactly — ×0.29 at
   a brightness of 20, ×1.98 at 200, against ×0.29 and ×1.99 for the
   page behind it. Which is the right answer anyway. The dial is a
   preview of the setting it is choosing, and a control that stayed
   true-coloured while the screen around it went dark would be showing
   you a brightness you are not going to get. It stays legible at both
   ends — that was the thing worth checking. */
  return createPortal(
    <AnimatePresence>
      {open && box ? (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: reduce ? 0 : -6, scale: reduce ? 1 : 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: reduce ? 0 : -4, scale: reduce ? 1 : 0.98 }}
          transition={{ duration: 0.18, ease: HOUSE_EASE }}
          style={{
            position: 'fixed',
            top: box.top,
            left: box.left,
            width: 244,
            zIndex: 2147483001,
          }}
        >
          <div className="assistant-shell" style={PORTAL_SHELL}>
            <div className="pa-sheet p-3" role="dialog" aria-label="Brightness">
              <div className="flex items-center gap-2.5">
                {/* Swaps at neutral. The range now runs past the page's own
                    brightness, and the icon is the cheapest way to say which
                    half of it you are in. */}
                {lifted ? (
                  <Sun
                    className="size-4 shrink-0 text-[color:var(--pa-ink-accent)]"
                    strokeWidth={1.9}
                    aria-hidden
                  />
                ) : (
                  <SunDim
                    className="size-4 shrink-0 text-[color:var(--pa-faint)]"
                    strokeWidth={1.9}
                    aria-hidden
                  />
                )}

                <input
                  ref={inputRef}
                  id={id}
                  type="range"
                  min={BRIGHTNESS_MIN}
                  max={BRIGHTNESS_MAX}
                  step={1}
                  value={brightness}
                  onChange={(event) => setBrightness(Number(event.target.value))}
                  aria-label="Brightness"
                  aria-valuetext={
                    brightness === BRIGHTNESS_NEUTRAL
                      ? '100 per cent — the page as it is'
                      : `${brightness} per cent`
                  }
                  className="pa-slider"
                  style={{
                    ['--pa-fill' as string]: `${pct}%`,
                    ['--pa-neutral' as string]: `${neutral}%`,
                  }}
                />

                <span className="w-[3.5ch] shrink-0 text-right text-[12px] tabular-nums text-[color:var(--pa-muted)]">
                  {brightness}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/* -------------------------------------------------------------------------
 * The hidden hotkey
 * ---------------------------------------------------------------------- */

/**
 * `Shift + B`, ignored while anything editable has focus.
 *
 * Not in the command palette on purpose. The palette is a list of everything
 * the portal can do, and putting it there would make it findable — which is
 * the one property this control was asked not to have.
 */
export function useBrightnessHotkey(onFire: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'B' && event.key !== 'b') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
      event.preventDefault();
      onFire();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFire]);
}
