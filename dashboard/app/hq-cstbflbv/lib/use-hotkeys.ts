'use client';

/* ---------------------------------------------------------------------------
 * use-hotkeys.ts — the portal's keyboard layer.
 *
 *   1 … 9      switch view, in the order the tabs appear (VIEW_IDS)
 *   q          jump to the quick-add bar
 *   ⌘K / ^K    command palette
 *   /          command palette
 *
 * Every binding stands down while the caret is inside a field, and none of the
 * bare keys fire while a modifier is held — so ⌘1 (browser tab) and ⌥/ still
 * behave the way the operating system intends.
 * ------------------------------------------------------------------------- */

import { useEffect, useRef } from 'react';
import { VIEW_IDS, type ViewId } from './types';

/** QuickAdd listens for this on `window` and focuses its input. */
export const FOCUS_QUICK_ADD_EVENT = 'assistant:focus-quick-add';

export interface HotkeyHandlers {
  onNavigate: (view: ViewId) => void;
  onPalette: () => void;
  onQuickAdd: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** True when the keystroke belongs to whatever the person is typing into. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Radix's command palette and comboboxes put focus on a role, not an input.
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

export function useHotkeys(h: HotkeyHandlers): void {
  // Handlers change identity every render; the listener should not.
  const handlersRef = useRef<HotkeyHandlers>(h);
  handlersRef.current = h;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;

      const handlers = handlersRef.current;
      const mod = event.metaKey || event.ctrlKey;

      // ⌘K / ^K — the one binding that is allowed to fire from inside a field.
      if (mod && !event.altKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        handlers.onPalette();
        return;
      }

      // ⌘Z / ^Z, and Shift+⌘Z to walk forward again — but never inside a field,
      // where the browser's own text history is the one the user means.
      if (mod && !event.altKey && (event.key === 'z' || event.key === 'Z')) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        if (event.shiftKey) handlers.onRedo();
        else handlers.onUndo();
        return;
      }

      if (mod || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.key === '/') {
        event.preventDefault();
        handlers.onPalette();
        return;
      }

      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault();
        handlers.onQuickAdd();
        window.dispatchEvent(new CustomEvent(FOCUS_QUICK_ADD_EVENT));
        return;
      }

      if (event.key >= '1' && event.key <= '9') {
        const index = Number(event.key) - 1;
        const view = VIEW_IDS[index];
        if (view) {
          event.preventDefault();
          handlers.onNavigate(view);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
