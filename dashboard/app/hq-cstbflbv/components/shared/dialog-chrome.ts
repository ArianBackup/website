/* ---------------------------------------------------------------------------
 * dialog-chrome.ts — the four constants every dialog in the portal needs.
 *
 * Radix portals its content to <body>, outside `.assistant-shell`, and every
 * `.pa-*` class is scoped under that — so each dialog wraps its own shell, and
 * each one needs the same handful of values to do it. They live here rather
 * than being retyped per file, because when they drifted apart the symptom was
 * a stray square corner peeking out from behind one dialog's rounded sheet and
 * not the others'.
 *
 * A dialog is centred with a TRANSFORM, so nothing inside one may rely on
 * `backdrop-filter` — a transformed ancestor silently kills it. Every surface
 * in a dialog is a flat token fill instead; `.pa-sheet` is exactly that.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';

/** Neutralises `.assistant-shell`'s page geometry inside a portal. */
export const PORTAL_SHELL = { minHeight: 0, overflowX: 'visible' } as const;

/**
 * The one rounded sheet a dialog is made of. `.pa-sheet` carries the radius,
 * the near-opaque fill, the lit edge and the elevation; `overflow-hidden` is
 * what stops a sticky header or footer squaring off the corner it sits against.
 */
/* `dvh`, not `vh`. On iOS Safari `vh` is the LARGE viewport — the one you
 * get with the toolbars retracted — while the dialog is transform-centred on
 * the CURRENT layout viewport. The difference is exactly the height of the
 * toolbar, and what lands under it is always the sticky footer holding the
 * confirm button, with no scroll that recovers it. `dvh` and `vh` are the
 * same number on a desktop browser. */
export const DIALOG_SURFACE =
  'pa-sheet flex max-h-[min(88dvh,760px)] flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]';

/**
 * The portal container, stripped back to a bare positioning box by `pa-portal`
 * (see the reset at the foot of assistant.css). These classes only decide how
 * wide and how transparent that box is.
 */
export const DIALOG_CONTENT = clsx(
  'block w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] gap-0',
  'border-0 bg-transparent p-0 shadow-none',
);

/**
 * The scrim. It renders outside `.assistant-shell`, where the `--pa-*` tokens
 * do not resolve, so it is a literal deep navy black — which reads as a modal
 * dim on the light stage and as a deepening on the dark one.
 */
export const DIALOG_OVERLAY = 'bg-[rgba(8,20,44,0.44)] backdrop-blur-[3px]';
