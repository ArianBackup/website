'use client';

/* ---------------------------------------------------------------------------
 * quick-add.tsx — the capture bar.
 *
 * The shortest path from a thought to the system. One line of text is parsed
 * live into a real task: a natural-language date, `!` for a Big Three slot,
 * `@goal` to link it up the cascade and `#area` to file it. Whatever the parser
 * understood is shown as badges beside the field BEFORE you commit, so the
 * grammar teaches itself.
 *
 *   Enter        → create the task
 *   Shift+Enter  → drop the raw line into the Inbox instead
 *   Escape       → clear and step away
 *   q            → focus here from anywhere (via the window event)
 *
 * THE PICKER
 * ----------
 * Typing `@` or `#` opens a menu of what already exists — goals for `@`, life
 * areas for `#` — filtered as you keep typing and dismissed on Escape. Before
 * this you had to remember the name and spell enough of it for the resolver to
 * find, which is a lot to ask of a bar whose whole point is speed.
 *
 * What it inserts is the SHORTEST token that still resolves back to the thing
 * you picked, through the very same lookup the parser uses (`shortestToken`).
 * The full slug of "Ship v2 and onboard the first 25 customers" would be
 * accurate and unusable; "@ship" is accurate too, as long as nothing else
 * matches it first, and that is exactly what the function checks.
 * ------------------------------------------------------------------------- */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { ArrowUp, Inbox, Plus, Star, Target } from 'lucide-react';

import { GlassButton, GLASS_BOX } from '@/components/ui/glass-button';

import { capitaliseOnType } from '../lib/capitalise';
import { relativeDayLabel } from '../lib/dates';
import { activeGoals } from '../lib/derive';
import { parseQuickAdd } from '../lib/parse';
import { useAssistant } from '../lib/store';
import { FOCUS_QUICK_ADD_EVENT } from '../lib/use-hotkeys';
import type { DayKey, Goal, LifeArea } from '../lib/types';

export interface QuickAddProps {
  /** The day an undated capture lands on. Defaults to today. */
  defaultDay?: DayKey;
  className?: string;
}

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** Matches `.pa-capture`'s own 999px, so the round parts of the bar agree. */
const PILL: CSSProperties = { borderRadius: 999 };

/* Tailwind reads `shadow-[var(…)]` as a shadow COLOUR rather than a box-shadow,
 * so the lift is applied directly. */
const MENU_SURFACE: CSSProperties = { boxShadow: 'var(--pa-shadow-xl)' };

/** Lowercases and flattens punctuation so `sub-90` matches `Sub 90`. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findByName<T extends { id: string }>(
  items: T[],
  hint: string,
  nameOf: (item: T) => string,
): T | null {
  const needle = normalise(hint);
  if (needle.length === 0) return null;
  const exact = items.find((item) => normalise(nameOf(item)) === needle);
  if (exact) return exact;
  return items.find((item) => normalise(nameOf(item)).includes(needle)) ?? null;
}

/** Keeps a badge honest without letting a long goal title wreck the bar. */
function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/* -------------------------------------------------------------------------
 * The picker
 * ---------------------------------------------------------------------- */

/** How many rows the menu will show at once. */
const MENU_LIMIT = 6;

/** A name as a token the parser can carry: no spaces, since a space ends one. */
function tokenFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The fewest leading words of `name` that still resolve back to it.
 *
 * `findByName` tries an exact normalised match and then falls back to the first
 * item that CONTAINS the needle, so a short token is only safe if the thing you
 * picked is the one that lookup lands on. This walks the prefixes and returns
 * the first that does, so "@ship" is inserted where it is unambiguous and the
 * longer token only where it has to be.
 */
function shortestToken(name: string, all: string[]): string {
  const words = tokenFor(name).split('-').filter(Boolean);
  const target = normalise(name);

  for (let count = 1; count < words.length; count += 1) {
    const candidate = words.slice(0, count).join('-');
    const needle = normalise(candidate);
    if (needle.length === 0) continue;
    const resolved =
      all.find((other) => normalise(other) === needle) ??
      all.find((other) => normalise(other).includes(needle));
    if (resolved !== undefined && normalise(resolved) === target) return candidate;
  }

  return tokenFor(name);
}

interface MenuOption {
  id: string;
  label: string;
  /** Inserted after the sigil. */
  token: string;
  /** The area's dot colour; goals borrow their area's. */
  color: string | null;
}

interface Trigger {
  sigil: '@' | '#';
  query: string;
  /** Index of the sigil in the raw value. */
  at: number;
}

/** The `@…` or `#…` being typed at the caret, if any. */
function triggerAt(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)([#@])([^\s#@!]*)$/.exec(before);
  if (!match) return null;
  const query = match[3] ?? '';
  return { sigil: match[2] as '@' | '#', query, at: caret - query.length - 1 };
}

export function QuickAdd({ defaultDay, className }: QuickAddProps): JSX.Element {
  const { data, actions, today } = useAssistant();
  const reduce = useReducedMotion();

  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* The caret has to be state, not a ref read, because what the menu shows is
   * derived from where it is — and a ref read inside a memo never re-runs. */
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  /* Escape closes the menu without clearing the field. Reset whenever the token
   * under the caret changes, so the next `@` opens again. */
  const [dismissed, setDismissed] = useState(false);

  /* The provider's live day, so "tomorrow" typed at 23:59 still means tomorrow
   * a minute later — the reference date rolls over with the clock. */
  const refDay = defaultDay ?? today;

  /* ---- live parse + resolution ---- */
  const preview = useMemo(() => {
    const parsed = parseQuickAdd(value, refDay);
    const goals = activeGoals(data);

    const area: LifeArea | null = parsed.areaHint
      ? findByName(data.areas, parsed.areaHint, (a) => a.name)
      : null;

    const scoped = area ? goals.filter((g) => g.areaId === area.id) : goals;

    let goal: Goal | null = null;
    if (parsed.goalHint) {
      goal =
        findByName(scoped, parsed.goalHint, (g) => g.title) ??
        findByName(goals, parsed.goalHint, (g) => g.title);
    } else if (area && scoped.length === 1) {
      // An area hint with exactly one live goal under it is unambiguous.
      goal = scoped[0] ?? null;
    }

    return {
      parsed,
      area,
      goal,
      day: parsed.scheduledFor ?? defaultDay ?? null,
      dated: parsed.scheduledFor !== null,
    };
  }, [value, refDay, defaultDay, data]);

  /* ---- the picker ---- */
  const trigger = useMemo(() => triggerAt(value, caret), [value, caret]);

  const options = useMemo((): MenuOption[] => {
    if (!trigger) return [];
    const needle = normalise(trigger.query);

    if (trigger.sigil === '#') {
      const names = data.areas.map((a) => a.name);
      return data.areas
        .filter((a) => needle.length === 0 || normalise(a.name).includes(needle))
        .slice(0, MENU_LIMIT)
        .map((a) => ({
          id: a.id,
          label: a.name,
          token: shortestToken(a.name, names),
          color: a.color,
        }));
    }

    const goals = activeGoals(data);
    const titles = goals.map((g) => g.title);
    const matches = goals.filter(
      (g) => needle.length === 0 || normalise(g.title).includes(needle),
    );

    /* An area already chosen on the line ranks its own goals first — the same
     * preference the resolver applies when it scopes by area before falling
     * back to the whole list. Ranked rather than filtered, so the menu never
     * hides a goal the resolver would still accept. */
    const areaId = preview.area?.id ?? null;
    const ranked =
      areaId === null
        ? matches
        : [...matches.filter((g) => g.areaId === areaId), ...matches.filter((g) => g.areaId !== areaId)];

    return ranked.slice(0, MENU_LIMIT).map((g) => ({
      id: g.id,
      label: g.title,
      token: shortestToken(g.title, titles),
      color: data.areas.find((a) => a.id === g.areaId)?.color ?? null,
    }));
  }, [trigger, data, preview.area]);

  const menuOpen = trigger !== null && options.length > 0 && !dismissed;

  /* A new token under the caret is a new menu: un-dismiss it and start at the
   * top rather than wherever the last one was left. */
  const tokenKey = trigger ? `${trigger.sigil}${trigger.at}` : null;
  useEffect(() => {
    setDismissed(false);
    setActive(0);
  }, [tokenKey]);

  useEffect(() => {
    setActive((current) => (current < options.length ? current : 0));
  }, [options.length]);

  /** Swaps the token under the caret for the chosen one and moves on. */
  const accept = useCallback(
    (option: MenuOption): void => {
      const node = inputRef.current;
      if (!node || !trigger) return;

      const head = value.slice(0, trigger.at);
      const tail = value.slice(trigger.at + 1 + trigger.query.length).replace(/^[ \t]+/, '');
      const inserted = `${trigger.sigil}${option.token} `;
      const next = `${head}${inserted}${tail}`;
      const at = head.length + inserted.length;

      // DOM first, then React — the same rule the hero note learned: a caret
      // restored a frame later loses to the next keystroke.
      node.value = next;
      node.setSelectionRange(at, at);
      setValue(next);
      setCaret(at);
      setDismissed(true);
    },
    [trigger, value],
  );

  /* ---- focus request from the hotkey layer ---- */
  useEffect(() => {
    const focusHere = (): void => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    };
    window.addEventListener(FOCUS_QUICK_ADD_EVENT, focusHere);
    return () => window.removeEventListener(FOCUS_QUICK_ADD_EVENT, focusHere);
  }, []);

  const reset = useCallback((keepFocus: boolean): void => {
    setValue('');
    if (keepFocus) inputRef.current?.focus();
  }, []);

  const commitTask = useCallback((): void => {
    const raw = value.trim();
    if (raw.length === 0) return;

    const { parsed, goal, day } = preview;
    const title = parsed.title.trim() || raw;

    const task = actions.addTask({
      title,
      goalId: goal ? goal.id : null,
      scheduledFor: day,
    });

    // `cycleBig3` picks the lowest free slot on that day — the same rule the
    // Today view uses, so a `!` capture can never double-claim rank one.
    if (parsed.big3 && day !== null) actions.cycleBig3(task.id);

    toast.success(day ? `Added for ${relativeDayLabel(day, refDay)}` : 'Added to your backlog', {
      description: goal ? `${title} — ${goal.title}` : title,
    });

    reset(true);
  }, [value, preview, actions, refDay, reset]);

  const commitInbox = useCallback((): void => {
    const raw = value.trim();
    if (raw.length === 0) return;
    actions.addInbox(raw);
    toast.success('Captured to your inbox', { description: raw });
    reset(true);
  }, [value, actions, reset]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    commitTask();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    /* The menu owns these keys while it is open, and only while it is open —
     * Enter still submits, and Escape still clears the bar, the moment it is
     * not. */
    if (menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : options.length - 1;
        setActive((current) => (current + step) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const option = options[active];
        if (option) {
          event.preventDefault();
          accept(option);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      commitInbox();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      reset(false);
      inputRef.current?.blur();
    }
  };

  const empty = value.trim().length === 0;
  const badgeMotion = {
    initial: { opacity: 0, scale: reduce ? 1 : 0.92, y: reduce ? 0 : 2 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: reduce ? 1 : 0.92 },
    transition: { duration: 0.16, ease: HOUSE_EASE },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.05 }}
      className={clsx(className)}
    >
      <form onSubmit={onSubmit} className="pa-capture relative flex items-center gap-2 p-2 sm:gap-2.5">
        {/* 40px throughout the bar — the leading chip, the inbox button and the
            glass submit all share one height, so the row has a single rhythm. */}
        {/* Fully round, like `.pa-capture` around it and like the glass submit
            at the far end — a squircle inside a pill was the odd one out.
            Inline, because `.assistant-shell .pa-chip` sets its own radius and
            outranks a utility class. */}
        <span className="pa-chip size-10 shrink-0" style={PILL} aria-hidden>
          <Plus className="size-4" strokeWidth={1.75} />
        </span>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(capitaliseOnType(event));
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          /* Selection changes that are not edits — arrow keys, clicks, a drag —
           * so the menu follows the caret out of a token as well as into one. */
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls="pa-capture-menu"
          aria-autocomplete="list"
          aria-activedescendant={menuOpen ? `pa-capture-option-${active}` : undefined}
          placeholder="Capture anything…"
          aria-label="Quick add a task"
          autoComplete="off"
          spellCheck={false}
          className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
        />

        {/* Parse preview. The row is reserved so badges never nudge the bar.
            Hidden below `sm` and re-rendered under the bar instead: at 390px
            the chip, inbox toggle, submit and gaps already take 152px of a
            340px content box, so 46% of badges left the field you are typing
            in about 32 characters wide — and `justify-end` with
            `overflow-hidden` clipped from the LEFT, so the day badge was the
            first thing sliced. */}
        <div className="hidden min-h-[26px] max-w-[46%] shrink-0 items-center justify-end gap-1.5 overflow-hidden sm:flex">
          <AnimatePresence initial={false}>
            {preview.day ? (
              <motion.span
                key={`day-${preview.day}`}
                {...badgeMotion}
                className="pa-badge"
                data-tone={preview.dated ? 'azure' : undefined}
              >
                {relativeDayLabel(preview.day, refDay)}
              </motion.span>
            ) : null}

            {preview.parsed.big3 ? (
              <motion.span key="big3" {...badgeMotion} className="pa-badge" data-tone="amber">
                <Star className="size-3" strokeWidth={2} />
                Big 3
              </motion.span>
            ) : null}

            {preview.area ? (
              <motion.span key={`area-${preview.area.id}`} {...badgeMotion} className="pa-badge">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: preview.area.color }}
                />
                {clip(preview.area.name, 16)}
              </motion.span>
            ) : null}

            {preview.goal ? (
              <motion.span
                key={`goal-${preview.goal.id}`}
                {...badgeMotion}
                className="pa-badge hidden sm:inline-flex"
                data-tone="azure"
              >
                <Target className="size-3" strokeWidth={2} />
                {clip(preview.goal.title, 22)}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>

        <button
          type="button"
          onClick={commitInbox}
          disabled={empty}
          className="pa-icon-btn pa-focus size-10 shrink-0 disabled:opacity-35"
          style={PILL}
          aria-label="Send to inbox instead (Shift + Enter)"
          data-tip="Send to inbox"
          data-tip-key="Shift + Enter"
        >
          <Inbox className="size-4" strokeWidth={1.75} />
        </button>

        {/* The one primary action on this surface. `.glass-button` resets itself
            with `all: unset`, so the disabled state is ours to paint: the native
            attribute blocks the click and the wrapper fades. */}
        <GlassButton
          className={clsx('glass-button--haze-light shrink-0', empty && 'opacity-70')}
          size="none"
          buttonClassName={GLASS_BOX.icon10.button}
          contentClassName={clsx('!flex items-center justify-center', GLASS_BOX.icon10.content)}
          type="submit"
          disabled={empty}
          aria-label="Add task"
        >
          <ArrowUp className="size-[1.15rem]" strokeWidth={2.75} aria-hidden="true" />
        </GlassButton>

        {/* ---- the picker ----
            Anchored to the bar rather than to the caret: a one-line field with
            a menu under its left edge is the shape people already know from
            every other capture box, and it needs no measuring of glyph widths
            to stay correct. */}
        <AnimatePresence>
          {menuOpen ? (
            <motion.ul
              id="pa-capture-menu"
              role="listbox"
              aria-label={trigger?.sigil === '#' ? 'Life areas' : 'Goals'}
              initial={{ opacity: 0, y: reduce ? 0 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -4 }}
              transition={{ duration: 0.14, ease: HOUSE_EASE }}
              style={MENU_SURFACE}
              className="absolute left-2 right-2 top-full z-30 mt-2 overflow-hidden rounded-[1.15rem] border border-[color:var(--pa-edge)] bg-[color:var(--pa-solid)] p-1 sm:left-14 sm:right-auto sm:w-[min(24rem,calc(100%-4rem))]"
            >
              {options.map((option, index) => (
                <li key={option.id}>
                  <button
                    type="button"
                    id={`pa-capture-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    data-active={index === active}
                    // The field must keep focus, or the menu closes underneath
                    // the click that was meant to choose from it.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => accept(option)}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-[0.85rem] px-2.5 py-2 text-left',
                      'text-[13px] text-[color:var(--pa-navy)] transition-colors duration-150',
                      'data-[active=true]:bg-[color:var(--pa-accent-bg)]',
                    )}
                  >
                    {option.color ? (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: option.color }}
                      />
                    ) : (
                      <Target
                        className="size-3.5 shrink-0 text-[color:var(--pa-faint)]"
                        strokeWidth={2}
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="shrink-0 text-[11px] text-[color:var(--pa-faint)]">
                      {trigger?.sigil}
                      {option.token}
                    </span>
                  </button>
                </li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </form>

      <div className="mt-2 flex items-center justify-between gap-3 px-4">
        <p className="truncate text-[11.5px] text-[color:var(--pa-faint)]">
          Try{' '}
          <span className="text-[color:var(--pa-muted)]">“draft Q3 deck tomorrow !”</span> — dates
          land it on a day, <span className="text-[color:var(--pa-muted)]">!</span> marks a Big 3,{' '}
          <span className="text-[color:var(--pa-muted)]">@goal</span> links it,{' '}
          <span className="text-[color:var(--pa-muted)]">#area</span> files it.
        </p>
        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-[color:var(--pa-faint)] sm:flex">
          <kbd className="rounded-[0.4rem] border border-[color:var(--pa-line)] bg-[color:var(--pa-tile)] px-1.5 py-px font-sans text-[10.5px] font-medium text-[color:var(--pa-faint)]">
            Q
          </kbd>
          from anywhere
        </span>
      </div>
    </motion.div>
  );
}
