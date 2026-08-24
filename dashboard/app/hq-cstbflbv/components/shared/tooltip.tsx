'use client';

/* ---------------------------------------------------------------------------
 * tooltip.tsx — the portal's own tooltips.
 *
 * The browser's `title` popup is a grey system rectangle in the platform's font
 * that appears a second and a half late, wherever the mouse happens to be, and
 * cannot be styled, positioned or animated. Eighty of them across nine views is
 * eighty places where the surface stops looking like itself. This replaces the
 * lot with one layer.
 *
 * ── How a thing gets a tooltip ─────────────────────────────────────────────
 *     <button data-tip="Delete" aria-label="Delete">…</button>
 *     <button data-tip="Close" data-tip-key="Esc" aria-label="Close">…</button>
 *
 * An attribute, not a wrapper component. There is exactly one listener for the
 * whole document and it resolves the trigger with `closest()`, so a tip costs
 * one attribute at the call site and nothing at all in the tree — no extra
 * element between a flex parent and its child, no provider, no ref forwarding
 * through the four components that already wrap some of these buttons. It also
 * reaches inside the dialogs, which Radix portals to <body> where a React
 * context from the page would not follow.
 *
 * `data-tip-key` renders its value as a keycap. Roughly a dozen of these tips
 * name a shortcut, and "Close — Esc" as one run of prose was always a sentence
 * pretending to be a legend.
 *
 * ── Accessibility ─────────────────────────────────────────────────────────
 * The tip itself is `aria-hidden`. It is decoration for a pointer; the name a
 * screen reader reads comes from the trigger's own `aria-label` or its visible
 * text, which is why every interactive trigger converted to `data-tip` carries
 * one. Announcing both would say everything twice.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 * Nothing on touch. A tooltip is a hover affordance, there is no hover on a
 * phone, and the gesture that would stand in for one — a long press — is
 * already taken by the brightness dial and by the platform's own text
 * selection. The tips whose content matters on a small screen say it in the
 * interface instead.
 *
 * Nothing on a disabled button either. Disabled controls do not dispatch
 * pointer events, so there is no hover to respond to. That costs two tips in
 * the whole portal — the undo and redo pair, whose disabled tip reads "Nothing
 * to undo", which is what the greyed-out button already says.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { PORTAL_SHELL } from './dialog-chrome';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** How long the pointer has to rest on something before it is asking. */
const OPEN_DELAY = 420;
/**
 * After one tip closes, the next opens instantly for this long.
 *
 * Without it, running the mouse along a row of six icon buttons is six separate
 * waits — you have already declared what you are doing by the second one.
 */
const WARM_MS = 320;

/** Between the trigger and the tip. */
const GAP = 9;
/** Between the tip and the edge of the viewport. */
const EDGE = 10;

/**
 * Above every dialog, sheet and toast.
 *
 * It does not compete with the brightness sheets and could not: those hang off
 * `html`, and `body` is a stacking context (`isolation: isolate`), so anything
 * rendered in here is under them whatever number it carries. Which is what you
 * want — a tooltip dims and brightens with the page rather than hanging over a
 * screen turned down to twenty per cent at full strength.
 */
const Z = 2147482900;

interface Anchor {
  el: HTMLElement;
  text: string;
  key: string | null;
}

interface Placed {
  top: number;
  left: number;
  side: 'top' | 'bottom';
  /** Where the caret sits along the tip's own width. */
  arrow: number;
}

function readTip(el: HTMLElement): Anchor | null {
  const text = el.getAttribute('data-tip');
  if (text === null || text.trim().length === 0) return null;
  const key = el.getAttribute('data-tip-key');
  return { el, text, key: key !== null && key.length > 0 ? key : null };
}

function triggerFor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-tip]');
}

/**
 * Mount ONCE, at the app root — above the shell's own view switching, so a tip
 * does not unmount mid-hover when the active view changes underneath it.
 */
export function TooltipLayer(): JSX.Element | null {
  const reduce = useReducedMotion();

  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  const tipRef = useRef<HTMLDivElement | null>(null);
  /* Mirrors `anchor` for the listeners, which are registered once and must not
   * be torn down and rebuilt every time a tip opens. */
  const anchorRef = useRef<Anchor | null>(null);

  const close = useCallback((): void => {
    anchorRef.current = null;
    setAnchor(null);
  }, []);

  /* ---- placement ----
   * Two passes, and it has to be two: the tip is centred on the trigger and
   * clamped to the viewport, and neither is computable before the text has
   * been laid out and measured. The first pass renders it hidden, this
   * measures, the second pass puts it where it belongs — all inside one commit
   * because the effect is a LAYOUT effect, so nothing is ever painted at the
   * wrong place. */
  const place = useCallback((): void => {
    const current = anchorRef.current;
    const tip = tipRef.current;
    if (!current || !tip) return;

    const r = current.el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;

    const above = r.top - GAP - h >= EDGE;
    const top = above ? r.top - GAP - h : r.bottom + GAP;

    const centre = r.left + r.width / 2;
    const limit = Math.max(EDGE, window.innerWidth - w - EDGE);
    const left = Math.min(Math.max(EDGE, centre - w / 2), limit);

    setPlaced({
      top,
      left,
      side: above ? 'top' : 'bottom',
      // Kept off the rounded corners even when the tip has been shoved sideways.
      arrow: Math.min(Math.max(11, centre - left), Math.max(11, w - 11)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!anchor) {
      setPlaced(null);
      return;
    }
    place();
  }, [anchor, place]);

  /* ---- the one listener ----
   * `pointerover` rather than a pair of enter/leave handlers: it bubbles, so a
   * single registration sees every element the pointer crosses, and "the
   * trigger under the pointer changed" — including changing to nothing — is
   * one comparison rather than two handlers that have to agree. */
  useEffect(() => {
    let timer = 0;
    let closedAt = 0;
    /* The trigger a countdown is running for. Held separately from `anchorRef`
     * — which only ever holds what is on SCREEN — so that a second
     * `pointerover` for the same element does not restart its own delay. */
    let pending: HTMLElement | null = null;
    /* The trigger that was just clicked. See `onPointerDown`. */
    let clicked: HTMLElement | null = null;

    const cancel = (): void => {
      pending = null;
      if (timer !== 0) {
        window.clearTimeout(timer);
        timer = 0;
      }
    };

    /** Takes down what is on screen. Leaves any countdown running. */
    const hide = (): void => {
      if (anchorRef.current === null) return;
      closedAt = Date.now();
      anchorRef.current = null;
      setAnchor(null);
    };

    const dismiss = (): void => {
      cancel();
      hide();
    };

    const open = (next: Anchor): void => {
      anchorRef.current = next;
      setAnchor(next);
    };

    const onOver = (event: PointerEvent): void => {
      // Hover only. See the header: touch gets no tooltips at all.
      if (event.pointerType !== 'mouse') return;

      const el = triggerFor(event.target);
      if (el !== null && el === (anchorRef.current?.el ?? pending)) return;
      // Still on the thing that was just clicked; it stays quiet until the
      // pointer has actually been somewhere else.
      if (el !== null && el === clicked) return;
      clicked = null;

      dismiss();
      if (el === null) return;

      const next = readTip(el);
      if (next === null) return;

      if (Date.now() - closedAt < WARM_MS) {
        open(next);
        return;
      }
      pending = el;
      timer = window.setTimeout(() => {
        timer = 0;
        pending = null;
        // The element may have gone in the interval — a row that finished its
        // exit animation, a dialog that closed under the pointer.
        if (el.isConnected) open(next);
      }, OPEN_DELAY);
    };

    /* Keyboard focus opens immediately and with no warm-up window: tabbing to
     * a control is already a deliberate act, and a delay on it reads as the
     * interface being slow rather than as restraint. `:focus-visible` is what
     * keeps this off a mouse click, which lands focus on the button too. */
    const onFocusIn = (event: FocusEvent): void => {
      const el = triggerFor(event.target);
      if (el === null || !el.matches(':focus-visible')) return;
      const next = readTip(el);
      if (next === null) return;
      cancel();
      open(next);
    };

    const onFocusOut = (event: FocusEvent): void => {
      if (triggerFor(event.target) === anchorRef.current?.el) dismiss();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss();
    };

    /* A click dismisses, and the thing clicked stays quiet until the pointer
     * has been somewhere else. Half of these triggers change their own label as
     * they are pressed — "Complete" becomes "Mark as not done" — and half open
     * something over the top of themselves; leaving the tip up means showing
     * the wrong sentence, or showing it through a dialog.
     *
     * The second half of that is not belt and braces. Dismissing alone was not
     * enough: pressing one of these usually re-renders it, the element under
     * the pointer changes, the browser dispatches a fresh `pointerover` — and
     * the warm window, which had just been opened by the dismissal itself, then
     * re-opened the tip with no delay at all. Whether a click made the tooltip
     * go away came down to whether the DOM happened to move underneath it. */
    const onPointerDown = (event: PointerEvent): void => {
      dismiss();
      clicked = triggerFor(event.target);
    };

    /* `hide`, NOT `dismiss` — the countdown has to survive this.
     *
     * A tip already on screen has to go: it is placed against a rectangle that
     * has just moved, and following the scroll would mean re-measuring on every
     * frame of it. But a scroll that ENDS with the pointer resting on a button
     * is how half of these tooltips get asked for — you wheel down the list and
     * stop on the thing you were looking for, and the pointer never moves
     * again. Cancelling the timer there meant no tooltip ever appeared until
     * you jiggled the mouse. If the content moved out from under the pointer
     * instead, the browser dispatches `pointerover` for the new element on its
     * own and the timer is re-aimed by the handler above.
     *
     * Capture, so a scroll inside a dialog body counts. */
    const onScroll = (): void => hide();

    window.addEventListener('pointerover', onOver);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    // The pointer leaving the window fires no `pointerover` anywhere.
    document.documentElement.addEventListener('pointerleave', dismiss);

    return () => {
      cancel();
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      document.documentElement.removeEventListener('pointerleave', dismiss);
    };
  }, []);

  /* ---- the trigger going away underneath an open tip ----
   * Nothing else catches it. A row that is deleted, a dialog that closes, a
   * list that re-sorts — the element the tip is anchored to simply stops being
   * in the document, and no pointer event fires because there is nothing left
   * to leave. Only runs while a tip is open, and only reads one boolean. */
  useEffect(() => {
    if (!anchor || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      if (!anchor.el.isConnected) close();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [anchor, close]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {anchor ? (
        <motion.div
          ref={tipRef}
          key="pa-tip"
          initial={{ opacity: 0, y: reduce ? 0 : 3, scale: reduce ? 1 : 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.97, transition: { duration: 0.1 } }}
          transition={{ duration: 0.15, ease: HOUSE_EASE }}
          style={{
            position: 'fixed',
            top: placed?.top ?? 0,
            left: placed?.left ?? 0,
            zIndex: Z,
            // Never in the way of the thing it is describing.
            pointerEvents: 'none',
            // Up for exactly one frame while it is being measured.
            visibility: placed ? 'visible' : 'hidden',
          }}
        >
          {/* The shell again, because this renders in <body> where none of the
              `--pa-*` tokens resolve — and neutralised by PORTAL_SHELL exactly
              as every dialog does it, or it would drag the page's own geometry
              in with it. */}
          <div className="assistant-shell" style={PORTAL_SHELL}>
            <div
              className="pa-tip"
              role="tooltip"
              aria-hidden="true"
              data-side={placed?.side ?? 'top'}
              style={{ ['--pa-tip-arrow' as string]: `${placed?.arrow ?? 0}px` }}
            >
              {anchor.text}
              {anchor.key ? <kbd className="pa-tip-key">{anchor.key}</kbd> : null}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
