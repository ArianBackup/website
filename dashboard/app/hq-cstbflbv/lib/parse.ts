/* ---------------------------------------------------------------------------
 * parse.ts — the quick-add grammar.
 *
 *   "Draft the pricing page tomorrow !"      → title, scheduledFor, big3
 *   "Long run friday #health @sub-90"        → title, scheduledFor, area + goal hints
 *   "Call the accountant in 3 days"          → title, scheduledFor
 *
 * Rules:
 *   `!`      anywhere marks the task as one of the day's Big Three
 *   `#word`  hints at a life area
 *   `@word`  hints at a goal
 *   any natural date phrase becomes `scheduledFor` and is stripped from the title
 * ------------------------------------------------------------------------- */

import * as chrono from 'chrono-node';
import { fromKey, todayKey, toKey } from './dates';
import type { DayKey } from './types';

export interface ParsedQuickAdd {
  title: string;
  scheduledFor: DayKey | null;
  big3: boolean;
  areaHint: string | null;
  goalHint: string | null;
}

/** `#health`, `#deep-work` — anything up to the next space. */
const AREA_TOKEN = /(^|\s)#([^\s#@!]+)/g;
/** `@sub-90`, `@runway` — same shape, different sigil. */
const GOAL_TOKEN = /(^|\s)@([^\s#@!]+)/g;

/** Connectives chrono tends to leave dangling once its match is cut out. */
const DANGLING_TRAILING = /[\s,–—-]+(?:on|by|at|due|for|before|from|until|till|this|next)$/i;
const DANGLING_LEADING = /^(?:on|by|at|due|for|before|from|until|till)\s+/i;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Trims the punctuation a stripped date phrase tends to leave behind. */
function tidy(text: string): string {
  let out = collapse(text);
  out = out.replace(/^[,;:–—-]+\s*/, '');
  out = out.replace(/\s*[,;:–—-]+$/, '');
  out = out.replace(DANGLING_TRAILING, '');
  out = out.replace(DANGLING_LEADING, '');
  return collapse(out);
}

/**
 * Parses a quick-add line.
 *
 * `refKey` anchors relative phrases ("tomorrow", "friday") so the grammar can
 * be tested and so planning from a day other than today behaves sensibly.
 */
export function parseQuickAdd(raw: string, refKey: DayKey = todayKey()): ParsedQuickAdd {
  const source = typeof raw === 'string' ? raw : '';
  const original = collapse(source);

  if (original.length === 0) {
    return { title: '', scheduledFor: null, big3: false, areaHint: null, goalHint: null };
  }

  // 1. Big Three marker.
  const big3 = original.includes('!');
  let text = original.replace(/!/g, ' ');

  // 2. Sigil hints. The first of each wins; every occurrence is stripped.
  let areaHint: string | null = null;
  let goalHint: string | null = null;

  AREA_TOKEN.lastIndex = 0;
  const areaMatch = AREA_TOKEN.exec(text);
  if (areaMatch) areaHint = areaMatch[2];
  text = text.replace(AREA_TOKEN, ' ');

  GOAL_TOKEN.lastIndex = 0;
  const goalMatch = GOAL_TOKEN.exec(text);
  if (goalMatch) goalHint = goalMatch[2];
  text = text.replace(GOAL_TOKEN, ' ');

  text = collapse(text);

  // 3. Natural-language date. Noon avoids DST edges when chrono shifts days.
  const reference = fromKey(refKey);
  reference.setHours(12, 0, 0, 0);

  let scheduledFor: DayKey | null = null;
  let titleSource = text;

  if (text.length > 0) {
    let results: chrono.ParsedResult[] = [];
    try {
      results = chrono.casual.parse(text, reference, { forwardDate: true });
    } catch {
      results = [];
    }

    const hit = results.find((r) => r.text.trim().length > 0);
    if (hit) {
      const when = hit.start.date();
      if (when instanceof Date && !Number.isNaN(when.getTime())) {
        scheduledFor = toKey(when);
        const before = text.slice(0, hit.index);
        const after = text.slice(hit.index + hit.text.length);
        const stripped = tidy(`${before} ${after}`);
        // "tomorrow" on its own is a date, not a task — keep the words the
        // person actually typed rather than handing back an empty title.
        titleSource = stripped.length > 0 ? stripped : text;
      }
    }
  }

  return {
    title: tidy(titleSource) || original,
    scheduledFor,
    big3,
    areaHint,
    goalHint,
  };
}
