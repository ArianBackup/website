/* ---------------------------------------------------------------------------
 * capitalise.ts — a capital letter at the start of every line you type.
 *
 * The phone keyboards already do this and the desktop does not, so a system you
 * fill in from both ends comes out half sentence-case and half not. This closes
 * the gap: the first letter of a line is capitalised as it is typed, on every
 * prose field in the portal.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * It fires on TYPING only — `inputType === 'insertText'`. Not on paste, which
 * arrives with its own casing and is nobody's business to rewrite; not during
 * an IME composition, where the "character" is not finished yet; and not on a
 * delete, so backspacing to the start and retyping is the escape hatch when a
 * line genuinely wants to begin lower-case (a package name, a CLI flag) —
 * paste it, or type the second letter first.
 *
 * It also touches EXACTLY ONE character, the one just typed, and only when it
 * is the first thing on its line. Nothing further along the string is
 * rewritten, so the caret never has to be recovered from a length change.
 *
 * ── Why the node is written directly ──────────────────────────────────────
 * Every field here is controlled, and React sets `node.value` on commit
 * whenever it differs from the props value — which moves the caret to the end
 * of the string. Harmless at the end of a line, wrong in the middle of a
 * textarea, which is precisely where the multi-line version of this fires. So
 * the corrected string is written to the node and the selection restored
 * BEFORE the state update: by the time React commits, `node.value` already
 * matches and it leaves the field alone.
 * ------------------------------------------------------------------------- */

import type { ChangeEvent } from 'react';

type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * List markers that a line is allowed to open with.
 *
 * Today's notes field opens every line with a `•` of its own accord, so without
 * this the one field most obviously made of lines would be the one field that
 * never capitalised any of them.
 */
const MARKERS = new Set(['•', '-', '–', '—', '*', '>']);

/** True when everything between `index` and the start of its line is blank. */
function atLineStart(value: string, index: number): boolean {
  let i = index - 1;
  let markers = 0;
  while (i >= 0) {
    const char = value[i] as string;
    if (char === '\n') return true;
    if (char === ' ' || char === '\t') {
      i -= 1;
      continue;
    }
    // One marker, and only with blank space between it and the line start.
    if (markers === 0 && MARKERS.has(char)) {
      markers += 1;
      i -= 1;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * `value` with the character at `index` upper-cased, or null if that would
 * change nothing.
 *
 * The length check is what keeps `ß` out: it upper-cases to `SS`, which is two
 * characters nobody typed and a caret one place further along than it was.
 * Scripts without case — CJK, Arabic, digits, punctuation — fail the first
 * check instead, because upper-casing them is the identity.
 */
function upperAt(value: string, index: number): string | null {
  const char = value[index];
  if (char === undefined) return null;
  const upper = char.toUpperCase();
  if (upper === char || upper.length !== char.length) return null;
  return `${value.slice(0, index)}${upper}${value.slice(index + 1)}`;
}

/**
 * Drop-in for `event.target.value` in the `onChange` of a prose field.
 *
 *     onChange={(event) => setDraft(capitaliseOnType(event))}
 *
 * Returns what the field should hold — the typed value, with the first letter
 * of the line capitalised when this keystroke started one.
 */
export function capitaliseOnType(event: ChangeEvent<TextField>): string {
  const field = event.currentTarget;
  const value = field.value;

  /* React's onChange for a text field is the native `input` event, which is an
   * InputEvent — but the type it hands over is the base Event, and a synthetic
   * dispatch (a test, an extension) may genuinely not be one. No inputType,
   * no idea what happened, no rewrite. */
  const native = event.nativeEvent as Partial<InputEvent>;
  if (native.inputType !== 'insertText' || native.isComposing === true) return value;

  const typed = native.data;
  if (typed === null || typed === undefined || typed.length === 0) return value;

  /* The caret sits at the far end of what was just inserted — including when
   * the keystroke replaced a selection, which is why this is subtraction and
   * not "the character before the caret". */
  const caret = field.selectionStart;
  if (caret === null) return value;
  const start = caret - typed.length;
  if (start < 0) return value;

  if (!atLineStart(value, start)) return value;

  const next = upperAt(value, start);
  if (next === null) return value;

  field.value = next;
  field.setSelectionRange(caret, caret);
  return next;
}
