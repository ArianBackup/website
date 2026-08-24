'use client';

/* ---------------------------------------------------------------------------
 * theme.ts — light and dark for the assistant portal.
 *
 * Dark mode is driven by `data-pa-theme="dark"` on <html>, NOT by the host
 * app's `.dark` class: the root layout runs an inline script that force-removes
 * `.dark` on every load, so a class would be stripped before it ever applied.
 * Our own attribute survives, can be set before first paint, and reaches dialog
 * portals — which render outside `.assistant-shell` but still inside <html>.
 *
 * ── Dark stands on the map ─────────────────────────────────────────────────
 * There was a third theme for a while: the dark ink family on a live map of
 * London rather than on the navy stage. It is not a third theme any more — it
 * IS dark mode. The plain navy ground is gone and nothing selects it.
 *
 * Dark still writes TWO attributes rather than one, and the split is worth
 * keeping even now that they always move together:
 *
 *   data-pa-theme='dark'   the ink family — tokens, pill, scrollbars, glow
 *   data-pa-stage='map'    the ground — the background and the handful of
 *                          surfaces that must sit on top of it
 *
 * Folding the ground into `data-pa-theme` would mean rewriting every
 * `[data-pa-theme='dark']` rule in the sheet to say something about a map, and
 * the ink would no longer be separable from what it stands on. Two attributes
 * cost one line here and keep the map a layer rather than a fork.
 *
 * The resolution order is:
 *
 *   1. an explicit choice in localStorage — the person pressed the toggle
 *   2. otherwise `prefers-color-scheme`, LIVE: until they choose, flipping the
 *      OS between light and dark flips the portal with it
 *
 * State lives in one module-level store rather than in each component, so a
 * toggle in the header and a switch in settings can never disagree, and a
 * change in another tab lands here through the `storage` event.
 *
 * `ready` is false until the mount effect has run. It exists because the first
 * render (server, or hydration) must not guess: callers hold a control's box
 * open and only paint its state once `ready` is true.
 * ------------------------------------------------------------------------- */

import { useMemo, useSyncExternalStore } from 'react';

export type PaTheme = 'light' | 'dark';

/** The cycle the toggle walks, in order. */
export const THEME_ORDER: readonly PaTheme[] = ['light', 'dark'] as const;

/** Versioned so a future change of shape cannot inherit a stale value. */
export const THEME_STORAGE_KEY = 'assistant.theme.v1';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface AssistantThemeControls {
  /** The theme in force right now. `'light'` until `ready`. */
  theme: PaTheme;
  /** Records an explicit choice, applies it, and stops following the OS. */
  setTheme: (next: PaTheme) => void;
  /** Explicit choice of the next theme in `THEME_ORDER`, wrapping at the end. */
  toggle: () => void;
  /** False until the stored choice has been read on the client. */
  ready: boolean;
}

interface ThemeSnapshot {
  theme: PaTheme;
  ready: boolean;
}

/* -------------------------------------------------------------------------
 * The store
 * ---------------------------------------------------------------------- */

/** The person's explicit choice. `null` means "follow the system". */
let choice: PaTheme | null = null;
/** What the OS currently prefers. */
let system: PaTheme = 'light';
let initialised = false;

/** Cached — `useSyncExternalStore` requires a stable object between ticks. */
let snapshot: ThemeSnapshot = { theme: 'light', ready: false };

/** Frozen for the server and the hydration render: no storage, no matchMedia. */
const SERVER_SNAPSHOT: ThemeSnapshot = { theme: 'light', ready: false };

const listeners = new Set<() => void>();

function isTheme(value: unknown): value is PaTheme {
  return value === 'light' || value === 'dark';
}

/**
 * Anything already in storage, read forward.
 *
 * `'map'` was the third theme's stored value and is now what dark mode looks
 * like, so it reads as `'dark'` rather than as garbage. Without this line
 * everyone who had picked the map would silently fall back to following the OS
 * — landing most of them on light, having chosen the darkest thing on offer.
 */
function migrate(raw: string | null): PaTheme | null {
  if (raw === 'map') return 'dark';
  return isTheme(raw) ? raw : null;
}

function readStored(): PaTheme | null {
  try {
    return migrate(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Private mode, or storage disabled. Fall back to the system preference.
    return null;
  }
}

/**
 * Stamps the two attributes. Dark is the dark ink family standing on the map
 * stage — see the note at the top of this file for why that is two attributes
 * and not one.
 */
function applyToDocument(theme: PaTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.paTheme = theme;
  if (theme === 'dark') root.dataset.paStage = 'map';
  else delete root.dataset.paStage;
}

/** Writes the attribute and, if anything moved, wakes every subscriber. */
function sync(): void {
  const theme = choice ?? system;
  applyToDocument(theme);

  if (snapshot.theme === theme && snapshot.ready === initialised) return;
  snapshot = { theme, ready: initialised };
  for (const listener of Array.from(listeners)) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== THEME_STORAGE_KEY) return;
  // A `null` newValue means the key was cleared — back to following the OS.
  choice = migrate(event.newValue);
  sync();
}

/**
 * Runs once, from the first subscription (an effect — never during render, so
 * storage is not touched while React is rendering).
 *
 * The listeners it attaches live for the lifetime of the page on purpose: they
 * are two, they are idempotent, and tearing them down on the last unmount would
 * mean the portal stopped following the OS the moment no toggle was on screen.
 */
function initialise(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  choice = readStored();

  const query = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  if (query) {
    system = query.matches ? 'dark' : 'light';
    query.addEventListener('change', (event: MediaQueryListEvent) => {
      system = event.matches ? 'dark' : 'light';
      // An explicit choice outranks the OS.
      if (choice === null) sync();
    });
  }

  window.addEventListener('storage', onStorage);
  sync();
}

function subscribe(listener: () => void): () => void {
  initialise();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemeSnapshot {
  return snapshot;
}

function getServerSnapshot(): ThemeSnapshot {
  return SERVER_SNAPSHOT;
}

function setTheme(next: PaTheme): void {
  if (!isTheme(next)) return;
  choice = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage refused it; the choice still holds for this session.
  }
  sync();
}

function toggle(): void {
  // Read the live value rather than a closed-over one, so two clicks in the
  // same frame cannot both advance from the same starting point.
  const current = choice ?? system;
  const index = THEME_ORDER.indexOf(current);
  setTheme(THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'light');
}

/* -------------------------------------------------------------------------
 * Hook
 * ---------------------------------------------------------------------- */

export function useAssistantTheme(): AssistantThemeControls {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // `setTheme` and `toggle` are module-level, so this identity only changes
  // when the theme itself does.
  return useMemo(
    () => ({ theme: state.theme, ready: state.ready, setTheme, toggle }),
    [state.theme, state.ready],
  );
}

/* -------------------------------------------------------------------------
 * Blocking init script
 * ---------------------------------------------------------------------- */

/**
 * Resolves the theme and stamps <html> BEFORE first paint, killing the flash of
 * light that a React effect cannot avoid. Inline it in the layout:
 *
 *   <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
 *
 * Self-contained, wrapped in try/catch (Safari throws on `localStorage` in
 * some privacy modes), and it contains no `</script>` sequence, so it is safe
 * to inline verbatim. It only ever sets the attribute the React store sets a
 * moment later, so the two cannot disagree.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=null;try{s=window.localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});}catch(e){}if(s==='map'){s='dark';}var t=(s==='dark'||s==='light')?s:(window.matchMedia&&window.matchMedia('${DARK_QUERY}').matches?'dark':'light');var d=document.documentElement;d.setAttribute('data-pa-theme',t);if(t==='dark'){d.setAttribute('data-pa-stage','map');}else{d.removeAttribute('data-pa-stage');}}catch(e){}})();`;
