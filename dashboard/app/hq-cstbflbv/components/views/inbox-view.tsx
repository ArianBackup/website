'use client';

/* ---------------------------------------------------------------------------
 * inbox-view.tsx — CAPTURE FAST, TRIAGE DELIBERATELY.
 *
 * The inbox exists so that a thought never has to be filed at the moment it
 * arrives. Two halves, and the whole surface is built around the seam:
 *
 *   1. the capture tile   one borderless field, no fields to fill in, no
 *                         decisions to make. Every non-empty line becomes its
 *                         own item, so a pasted brain-dump lands as a list.
 *   2. the waiting list   one thought per row, and exactly four ways out:
 *                         Today, Someday, a goal, or the bin. Each of them is
 *                         undoable, so triage never feels irreversible.
 *
 * Nothing here holds state that the store could hold instead; every change goes
 * through `actions.*` and every number is read off the document.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import { format, formatDistanceToNowStrict } from 'date-fns';
import {
  Archive,
  CalendarArrowDown,
  CornerDownLeft,
  Inbox,
  PenLine,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

import { capitaliseOnType } from '../../lib/capitalise';
import { useAssistant } from '../../lib/store';
import type { DayKey, ID, InboxItem } from '../../lib/types';

import { EmptyState } from '../shared/empty-state';
import { GoalPicker } from '../shared/goal-picker';
import { SectionHeader } from '../shared/section-header';

/* -------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------- */

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** Above this, the header stops counting and starts nudging. */
const TRIAGE_NUDGE = 10;

/** The capture field never collapses below two lines, never grows past eight. */
const CAPTURE_MIN_HEIGHT = 54;
const CAPTURE_MAX_HEIGHT = 220;

/** How often the "2 hours ago" stamps are refreshed. */
const CLOCK_TICK_MS = 60_000;

/** How much of a captured line a toast is willing to repeat back. */
const TOAST_CLIP = 78;

/** Keeps a pill's shape while focused, which `.pa-focus` would square off. */
const PILL_FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--pa-accent-ring)]';

/* The glass pill carries no focus style of its own, and its look is built out of
 * five stacked box-shadows — so the keyboard ring has to be an OUTLINE, which
 * follows the pill's radius without touching any of that. */
const GLASS_FOCUS = clsx(
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-[color:var(--pa-azure)]',
);

/** The quiet bordered pill used for every secondary decision. */
/** True on a touch device. Read at call time — a tablet can gain a mouse. */
function coarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

const QUIET_PILL = clsx(
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3',
  'border-[color:var(--pa-line)] bg-[color:var(--pa-tile)] text-[12.5px] font-medium text-[color:var(--pa-muted)]',
  'transition-colors duration-150',
  'hover:border-[color:var(--pa-accent-border)] hover:bg-[color:var(--pa-row-hover)] hover:text-[color:var(--pa-navy)]',
  PILL_FOCUS,
);

/** Keycap chip. Matches the one on the quick-add bar, so the language is one. */
const KBD = clsx(
  'inline-flex items-center rounded-[0.4rem] border border-[color:var(--pa-line)] bg-[color:var(--pa-tile)]',
  'px-1.5 py-px font-sans text-[10.5px] font-medium leading-[1.6] text-[color:var(--pa-faint)]',
);

/* An empty inbox is an achievement, not an absence — the shared EmptyState is
 * re-tinted green for this one case. `!` beats the kit's own specificity, and
 * the tint is mixed FROM `--pa-green` rather than written as a literal, so the
 * chip stays legible once the stage turns navy-black. The hairline uses the
 * arbitrary-PROPERTY form: `shadow-[…]` would see `color-mix(` and mistake the
 * whole value for a shadow COLOUR. */
const REWARD_EMPTY = clsx(
  '[&_.pa-chip]:!bg-[color:var(--pa-green-bg)]',
  '[&_.pa-chip]:!text-[color:var(--pa-green)]',
  '[&_.pa-chip]:![box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--pa-green)_26%,transparent),var(--pa-highlight)]',
);

/* -------------------------------------------------------------------------
 * Small pure helpers
 * ---------------------------------------------------------------------- */

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Splits a brain-dump into the items it actually contains. */
function toLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * `'Just now' | '12 minutes ago' | '3 days ago'`.
 * The `_tick` argument is never read — it exists so the label recomputes when
 * the view's clock advances.
 */
function capturedAgo(iso: string, _tick: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Captured';
  if (Date.now() - at.getTime() < 60_000) return 'Just now';
  return formatDistanceToNowStrict(at, { addSuffix: true });
}

function capturedOn(iso: string): string | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return `Captured ${format(at, "EEE d MMM yyyy 'at' HH:mm")}`;
}

/** What put the highlight on a row — a pointer press, or focus arriving. */
export type ActivationSource = 'pointer' | 'focus';

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function InboxView(): JSX.Element {
  /* `today` comes from the provider, which owns a LIVE day: it flips on its own
   * at midnight and re-renders this tree, so a thought triaged at 00:01 lands on
   * the new day without a reload. */
  const { data, today, actions } = useAssistant();
  const reduce = Boolean(useReducedMotion());

  const listRef = useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const [tick, setTick] = useState(() => Date.now());

  /* Where the highlight was the last time it was somewhere, so a round trip
   * through <body> (a click that removes the button it was on) comes back to
   * the same place in the list rather than to the top of it. */
  const lastIndexRef = useRef(0);

  /* Newest first: the thought you just had is the one you are still holding. */
  const items = useMemo<InboxItem[]>(
    () =>
      [...data.inbox].sort((a, b) => {
        if (a.createdAt === b.createdAt) return 0;
        return a.createdAt < b.createdAt ? 1 : -1;
      }),
    [data.inbox],
  );

  const count = items.length;

  /* ---- keep the relative stamps honest ---- */
  useEffect(() => {
    if (count === 0) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [count]);

  /* ---- the highlight can never point past the end of a shrinking list ---- */
  useEffect(() => {
    setHighlight((current) => (current < 0 ? -1 : Math.min(current, count - 1)));
  }, [count]);

  useEffect(() => {
    if (highlight >= 0) lastIndexRef.current = highlight;
  }, [highlight]);

  /* ---- mutations ---- */

  /**
   * Triaging with the mouse removes the very button that was clicked, which
   * would drop focus onto <body> and end the keyboard session. If the list held
   * focus before the change, it takes it back once React has committed.
   */
  const keepListFocus = useCallback((): void => {
    const el = listRef.current;
    if (!el || !el.contains(document.activeElement)) return;
    window.requestAnimationFrame(() => {
      listRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const triage = useCallback(
    (item: InboxItem, day: DayKey | null, goalId: ID | null): void => {
      keepListFocus();
      try {
        const task = actions.convertInboxToTask(item.id, { scheduledFor: day, goalId });
        const goal = goalId === null ? null : (data.goals.find((g) => g.id === goalId) ?? null);

        const title = goal
          ? `Linked to ${clip(goal.title, 32)}`
          : day === null
            ? 'Moved to your backlog'
            : 'Scheduled for today';

        toast.success(title, {
          description: clip(item.text, TOAST_CLIP),
          action: {
            label: 'Undo',
            onClick: () => {
              actions.deleteTask(task.id);
              actions.addInbox(item.text);
              toast('Back in your inbox', { description: clip(item.text, TOAST_CLIP) });
            },
          },
        });
      } catch {
        toast.error('That thought is no longer in your inbox.');
      }
    },
    [actions, data.goals, keepListFocus],
  );

  const remove = useCallback(
    (item: InboxItem): void => {
      keepListFocus();
      actions.deleteInbox(item.id);
      toast.success('Removed from your inbox', {
        description: clip(item.text, TOAST_CLIP),
        action: {
          label: 'Undo',
          onClick: () => {
            actions.addInbox(item.text);
            toast('Back in your inbox', { description: clip(item.text, TOAST_CLIP) });
          },
        },
      });
    },
    [actions, keepListFocus],
  );

  const handleToday = useCallback(
    (item: InboxItem): void => triage(item, today, null),
    [triage, today],
  );

  const handleSomeday = useCallback((item: InboxItem): void => triage(item, null, null), [triage]);

  const handleLink = useCallback(
    (item: InboxItem, goalId: ID): void => triage(item, today, goalId),
    [triage, today],
  );

  /* ---- keyboard triage ---- */

  const onListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (items.length === 0) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const { key } = event;

      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => {
          const from = current < 0 ? (key === 'ArrowDown' ? -1 : items.length) : current;
          const next = key === 'ArrowDown' ? from + 1 : from - 1;
          return Math.max(0, Math.min(items.length - 1, next));
        });
        return;
      }

      if (key === 'Home' || key === 'End') {
        event.preventDefault();
        setHighlight(key === 'Home' ? 0 : items.length - 1);
        return;
      }

      const item = highlight >= 0 && highlight < items.length ? items[highlight] : null;
      if (!item) return;

      if (key === 't' || key === 'T') {
        event.preventDefault();
        handleToday(item);
        return;
      }
      if (key === 's' || key === 'S') {
        event.preventDefault();
        handleSomeday(item);
        return;
      }
      if (key === 'Backspace' || key === 'Delete') {
        event.preventDefault();
        remove(item);
      }
    },
    [items, highlight, handleToday, handleSomeday, remove],
  );

  /**
   * A pointer press also hands the list the keyboard, so the shortcuts are live
   * the moment a row is touched. Focus moving INTO a row must not do that — it
   * would yank focus back off whatever the Tab key just reached.
   */
  const activate = useCallback((index: number, source: ActivationSource): void => {
    setHighlight(index);
    if (source === 'pointer') listRef.current?.focus({ preventScroll: true });
  }, []);

  const onListFocus = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>): void => {
      if (event.target !== listRef.current) return;
      setHighlight((current) => {
        if (current >= 0) return current;
        return Math.max(0, Math.min(lastIndexRef.current, count - 1));
      });
    },
    [count],
  );

  const onListBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next && listRef.current?.contains(next)) return;
    setHighlight(-1);
  }, []);

  /* ---- copy ---- */

  const subtitle =
    count === 0
      ? 'Nothing waiting — the fastest inbox there is to triage.'
      : count > TRIAGE_NUDGE
        ? `${count} thoughts waiting. Worth a triage pass.`
        : `${count} ${plural(count, 'thought', 'thoughts')} waiting. Send each one to a day, a goal, or the backlog.`;

  const badgeTone = count === 0 ? 'green' : count > TRIAGE_NUDGE ? 'amber' : 'azure';

  const rise = (index: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.35,
      ease: HOUSE_EASE,
      delay: reduce ? 0 : Math.min(index * 0.05, 0.3),
    },
  });

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* =============================================================
          1 — header + capture
          ============================================================= */}
      <motion.section {...rise(0)} className="pa-panel p-5 sm:p-6">
        <SectionHeader
          eyebrow="Capture"
          title="Inbox"
          subtitle={subtitle}
          icon={Inbox}
          action={
            <div className="flex items-center gap-2.5">
              <span className="hidden items-center gap-1.5 text-[11.5px] leading-none text-[color:var(--pa-faint)] lg:inline-flex">
                <Kbd>⇧</Kbd>
                <Kbd>Enter</Kbd>
                <span>in quick add sends here</span>
              </span>
              <span className="pa-badge" data-tone={badgeTone}>
                {count === 0 ? 'Empty' : `${count} waiting`}
              </span>
            </div>
          }
        />

        <InboxCapture className="mt-5" />
      </motion.section>

      {/* =============================================================
          2 — the waiting list
          ============================================================= */}
      <motion.section {...rise(1)} className="pa-panel p-5 sm:p-6">
        {count === 0 ? (
          <EmptyState
            className={REWARD_EMPTY}
            icon={Inbox}
            title="Inbox zero"
            description="Nothing waiting. Capture anything on your mind and triage it later."
            action={
              <button
                type="button"
                onClick={() => {
                  window.location.hash = 'today';
                }}
                className={clsx('pa-cta h-9 px-4 text-[13px]', PILL_FOCUS)}
              >
                <CalendarArrowDown className="size-4" strokeWidth={1.9} aria-hidden="true" />
                Back to today
              </button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="pa-eyebrow leading-none">Waiting</h2>
              <span className="text-[11.5px] leading-none text-[color:var(--pa-faint)]">
                Newest first
              </span>
              <span className="pa-divider hidden flex-1 sm:block" aria-hidden="true" />
              <span className="text-[11.5px] leading-none text-[color:var(--pa-faint)]">
                {count} {plural(count, 'item', 'items')}
              </span>
            </div>

            <div
              ref={listRef}
              role="list"
              tabIndex={0}
              aria-label="Captured thoughts. Arrow keys move, T sends to today, S sends to someday, Backspace deletes."
              aria-keyshortcuts="ArrowUp ArrowDown T S Backspace"
              onKeyDown={onListKeyDown}
              onFocus={onListFocus}
              onBlur={onListBlur}
              className={clsx(
                '-m-1 mt-3 flex flex-col gap-2 rounded-[1.25rem] p-1',
                'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--pa-accent-ring)]',
              )}
            >
              <AnimatePresence>
                {items.map((item, index) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    index={index}
                    active={index === highlight}
                    reduce={reduce}
                    tick={tick}
                    onActivate={activate}
                    onToday={handleToday}
                    onSomeday={handleSomeday}
                    onLink={handleLink}
                    onDelete={remove}
                  />
                ))}
              </AnimatePresence>
            </div>

            <span className="pa-divider mt-4 hidden sm:block" aria-hidden="true" />

            {/* Three lines of sub-12px text describing ↑ ↓ T S ⌫ — keys a phone
                does not have. */}
            <div className="mt-3.5 hidden flex-wrap items-center gap-x-4 gap-y-2 sm:flex">
              <Shortcut keys={['↑', '↓']} label="move" />
              <Shortcut keys={['T']} label="today" />
              <Shortcut keys={['S']} label="someday" />
              <Shortcut keys={['⌫']} label="delete" />
              <span className="ml-auto text-[11px] leading-none text-[color:var(--pa-faint)]">
                Click the list, then triage without touching the mouse.
              </span>
            </div>
          </>
        )}
      </motion.section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Capture — the whole point of the surface
 * ---------------------------------------------------------------------- */

export interface InboxCaptureProps {
  className?: string;
}

function InboxCapture({ className }: InboxCaptureProps): JSX.Element {
  const { actions } = useAssistant();
  const reduce = Boolean(useReducedMotion());
  const hintId = useId();

  const [value, setValue] = useState('');
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const lines = useMemo<string[]>(() => toLines(value), [value]);
  const empty = lines.length === 0;

  /* ---- grow with the thought, up to a ceiling ---- */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, CAPTURE_MIN_HEIGHT), CAPTURE_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > CAPTURE_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  const capture = useCallback((): void => {
    if (lines.length === 0) return;

    for (const line of lines) actions.addInbox(line);

    if (lines.length === 1) {
      toast.success('Captured', { description: clip(lines[0] ?? '', TOAST_CLIP) });
    } else {
      toast.success(`${lines.length} thoughts captured`, {
        description: 'They are waiting below, whenever you want to triage.',
      });
    }

    setValue('');
    areaRef.current?.focus();
  }, [lines, actions]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      capture();
      return;
    }
    /* A soft keyboard has no Shift+Enter, so on a phone every return filed the
     * thought and the newline was unreachable — under a placeholder that says
     * "one thought per line", with a whole multi-line feature behind it. The
     * Capture button is the touch submit. */
    if (event.key === 'Enter' && !event.shiftKey && !coarsePointer()) {
      event.preventDefault();
      capture();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setValue('');
      areaRef.current?.blur();
    }
  };

  return (
    <div className={clsx('pa-tile p-3 sm:p-3.5', className)}>
      <div className="flex items-start gap-3">
        <span className="pa-chip mt-1 size-8 shrink-0 rounded-[0.72rem]" aria-hidden="true">
          <PenLine className="size-4" strokeWidth={1.75} />
        </span>

        <textarea
          ref={areaRef}
          value={value}
          onChange={(event) => setValue(capitaliseOnType(event))}
          onKeyDown={onKeyDown}
          rows={2}
          spellCheck
          aria-label="Capture a thought"
          aria-describedby={hintId}
          placeholder="Empty your head — one thought per line"
          className={clsx(
            'min-w-0 flex-1 resize-none border-0 bg-transparent py-1.5',
            'text-[14px] leading-relaxed text-[color:var(--pa-navy)] outline-none',
            'placeholder:text-[color:var(--pa-faint)]',
          )}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 sm:pl-11">
        <p
          id={hintId}
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] leading-none text-[color:var(--pa-faint)]"
        >
          <Kbd>Enter</Kbd>
          <span>captures</span>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <Kbd>⇧</Kbd>
          <Kbd>Enter</Kbd>
          <span>new line</span>
          <span aria-hidden="true" className="hidden opacity-50 sm:inline">
            ·
          </span>
          <span className="hidden sm:inline">every line becomes its own item</span>
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <AnimatePresence initial={false}>
            {lines.length > 1 ? (
              <motion.span
                key="lines"
                initial={{ opacity: 0, scale: reduce ? 1 : 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.92 }}
                transition={{ duration: 0.16, ease: HOUSE_EASE }}
                className="pa-badge"
                data-tone="azure"
              >
                {lines.length} items
              </motion.span>
            ) : null}
          </AnimatePresence>

          {/* The one primary action on this surface. */}
          <GlassButton
            className={clsx(
              'glass-button--haze-light shrink-0',
              empty && 'cursor-not-allowed opacity-45',
            )}
            size="none"
            type="button"
            disabled={empty}
            data-tip="Capture"
            data-tip-key="Enter"
            buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
            contentClassName={GLASS_BOX.h10.content}
            onClick={capture}
          >
            <span className="inline-flex items-center gap-2">
              <CornerDownLeft className="size-4" aria-hidden="true" />
              {lines.length > 1 ? `Capture ${lines.length}` : 'Capture'}
            </span>
          </GlassButton>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Row — one thought, four ways out
 * ---------------------------------------------------------------------- */

export interface InboxRowProps {
  item: InboxItem;
  /** Position in the list — drives the entrance stagger and the highlight. */
  index: number;
  /** True when the keyboard highlight is sitting on this row. */
  active: boolean;
  reduce: boolean;
  /** Advances with the view's clock so the "ago" stamp stays true. */
  tick: number;
  onActivate: (index: number, source: ActivationSource) => void;
  onToday: (item: InboxItem) => void;
  onSomeday: (item: InboxItem) => void;
  onLink: (item: InboxItem, goalId: ID) => void;
  onDelete: (item: InboxItem) => void;
}

function InboxRow({
  item,
  index,
  active,
  reduce,
  tick,
  onActivate,
  onToday,
  onSomeday,
  onLink,
  onDelete,
}: InboxRowProps): JSX.Element {
  const [linking, setLinking] = useState(false);

  const ago = useMemo(() => capturedAgo(item.createdAt, tick), [item.createdAt, tick]);
  const exactly = useMemo(() => capturedOn(item.createdAt), [item.createdAt]);

  const label = clip(item.text, 40);

  /* The action cluster is always there on touch widths, and appears on hover,
   * focus or keyboard highlight on a pointer. */
  const cluster = clsx(
    'flex shrink-0 items-center gap-1.5 transition-opacity duration-200',
    'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100',
    (active || linking) && 'sm:opacity-100',
  );

  return (
    <motion.div
      role="listitem"
      layout={reduce ? false : 'position'}
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{
        opacity: 0,
        x: reduce ? 0 : 28,
        transition: { duration: 0.22, ease: HOUSE_EASE },
      }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      onFocus={() => onActivate(index, 'focus')}
      onMouseDown={() => onActivate(index, 'pointer')}
      className="min-w-0"
    >
      <div
        className={clsx(
          'pa-row pa-row-hover group px-3 py-2.5',
          active && 'outline outline-2 outline-offset-2 outline-[color:var(--pa-accent-border)]',
        )}
      >
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
          {/* ---- the thought ---- */}
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden="true"
              className={clsx(
                'mt-[7px] size-[7px] shrink-0 rounded-full transition-colors duration-200',
                active
                  ? 'bg-[color:var(--pa-azure)] ring-[5px] ring-[color:var(--pa-accent-glow)]'
                  : clsx(
                      'bg-[color:var(--pa-faint)] ring-4 ring-[color:var(--pa-line-soft)]',
                      'group-hover:bg-[color:var(--pa-azure)] group-hover:ring-[color:var(--pa-accent-bg)]',
                    ),
              )}
            />

            <div className="min-w-0 flex-1">
              <p
                data-tip={item.text}
                className="line-clamp-2 break-words text-[13.5px] leading-snug text-[color:var(--pa-navy)]"
              >
                {item.text}
              </p>
              <p
                data-tip={exactly}
                className="mt-1 text-[11.5px] leading-none text-[color:var(--pa-faint)]"
              >
                {ago}
              </p>
            </div>
          </div>

          {/* ---- triage ---- */}
          <div className={cluster}>
            <button
              type="button"
              onClick={() => onToday(item)}
              data-tip="Schedule for today"
              data-tip-key="T"
              aria-label={`Schedule "${label}" for today`}
              className={clsx('pa-cta h-8 px-3 text-[12.5px]', PILL_FOCUS)}
            >
              <CalendarArrowDown className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              Today
            </button>

            <button
              type="button"
              onClick={() => onSomeday(item)}
              data-tip="Move to the backlog"
              data-tip-key="S"
              aria-label={`Move "${label}" to the backlog`}
              className={QUIET_PILL}
            >
              <Archive className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              Someday
            </button>

            <button
              type="button"
              onClick={() => setLinking((open) => !open)}
              aria-expanded={linking}
              aria-label={`Link "${label}" to a goal`}
              data-tip="Link to a goal"
              className={clsx(
                'pa-icon-btn pa-focus size-8',
                linking && 'bg-[color:var(--pa-accent-bg)]',
              )}
              style={linking ? { color: 'var(--pa-azure)' } : undefined}
            >
              <Target className="size-4" strokeWidth={1.9} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onDelete(item)}
              data-danger="true"
              aria-label={`Delete "${label}"`}
              data-tip="Delete"
              data-tip-key="Backspace"
              className="pa-icon-btn pa-focus size-8"
            >
              <Trash2 className="size-4" strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* ---- the goal drawer ---- */}
        <AnimatePresence initial={false}>
          {linking ? (
            <motion.div
              key="link"
              initial={{ opacity: 0, height: reduce ? 'auto' : 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: reduce ? 'auto' : 0 }}
              transition={{ duration: 0.22, ease: HOUSE_EASE }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 border-t border-[color:var(--pa-line-soft)] pt-2.5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="w-full sm:max-w-[300px]">
                    <GoalPicker
                      value={null}
                      placeholder="Choose the goal it serves…"
                      onChange={(goalId) => {
                        setLinking(false);
                        if (goalId === null) return;
                        onLink(item, goalId);
                      }}
                    />
                  </div>

                  <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                    Linking turns it into a task on that goal, scheduled for today.
                  </p>

                  <button
                    type="button"
                    onClick={() => setLinking(false)}
                    aria-label="Cancel linking"
                    data-tip="Cancel"
                    className="pa-icon-btn pa-focus size-8 shrink-0 self-start sm:self-auto"
                  >
                    <X className="size-4" strokeWidth={1.9} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
 * Keycaps
 * ---------------------------------------------------------------------- */

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

function Kbd({ children, className }: KbdProps): JSX.Element {
  return <kbd className={clsx(KBD, className)}>{children}</kbd>;
}

export interface ShortcutProps {
  keys: string[];
  label: string;
}

function Shortcut({ keys, label }: ShortcutProps): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] leading-none text-[color:var(--pa-faint)]">
      <span className="inline-flex items-center gap-1">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
      {label}
    </span>
  );
}
