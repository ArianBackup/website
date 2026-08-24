'use client';

/* ---------------------------------------------------------------------------
 * TaskRow — the atom of the whole product.
 *
 * It appears in Today, the Week board, Goals, the Inbox triage and search, so
 * it is deliberately SELF-SUFFICIENT: it reads the store itself and owns every
 * interaction on a task (complete, rename, rank, reschedule, delete). Callers
 * pass a `Task` and a couple of display switches, nothing more.
 *
 * Layout:
 *   [ check ]  [ rank ] title              [ date ] [ ★ ] [ → today ] [ ✕ ]
 *              [ goal › milestone ]  [ carried 3× ]
 *
 * The action cluster is opacity-0 until the row is hovered OR something inside
 * it takes focus — invisible to the eye, never invisible to the keyboard. On a
 * coarse pointer there is no hover at all, so it is simply always visible.
 *
 * Completion feedback is the check's own spring plus every progress bar that
 * watches this task moving. Nothing fires, nothing flashes.
 *
 * Colour: every value here is a `--pa-*` token, so the row flips with
 * `data-pa-theme` without a single dark-mode branch.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import {
  CalendarArrowDown,
  CalendarDays,
  Check,
  ChevronRight,
  RotateCcw,
  Star,
  Target,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { capitaliseOnType } from '../../lib/capitalise';
import { formatKey, isPastDay, relativeDayLabel } from '../../lib/dates';
import { goalTrace } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { ID, Task } from '../../lib/types';

export interface TaskRowProps {
  task: Task;
  /** Position in its list — drives the entrance stagger only. */
  index?: number;
  /** Show the scheduled-day badge. Off by default: most lists are one day. */
  showDate?: boolean;
  /** Show the goal › milestone breadcrumb. On by default — the "why" matters. */
  showTrace?: boolean;
  /** Tighter row for the week board and other narrow columns. */
  dense?: boolean;
  /** Makes the breadcrumb clickable. Omit and it renders as plain text. */
  onOpenGoal?: (goalId: ID) => void;
  className?: string;
}

/**
 * Shown on every icon button so the cluster is discoverable without a tooltip
 * lib. The coarse-pointer branch matters: a touch device never fires hover, so
 * without it the actions would be unreachable on a phone.
 */
const ACTION_BTN =
  'pa-icon-btn pa-focus size-7 shrink-0 opacity-0 transition-opacity duration-200 [@media(pointer:coarse)]:opacity-100 ' +
  'group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ' +
  '[@media(pointer:coarse)]:opacity-100';

/** Keeps the pill shape while focused, which `.pa-focus` would square off. */
const PILL_FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--pa-accent-ring)]';

export function TaskRow({
  task,
  index = 0,
  showDate = false,
  showTrace = true,
  dense = false,
  onOpenGoal,
  className,
}: TaskRowProps): JSX.Element {
  /* `today` comes from the provider, which owns the live day — the row
   * re-labels itself the moment the clock rolls over midnight. */
  const { data, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Set by Escape so the blur that follows discards instead of saving. */
  const abortRef = useRef(false);

  const done = task.completedAt !== null;
  const ranked = task.big3Rank !== null;

  const { goal, milestone } = goalTrace(data, task);
  const scheduled = task.scheduledFor;
  const overdue = scheduled !== null && !done && isPastDay(scheduled, today);
  const isTodayRow = scheduled === today;

  /* ---- focus + select the moment an inline rename opens ---- */
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const startEdit = useCallback((): void => {
    abortRef.current = false;
    setDraft(task.title);
    setEditing(true);
  }, [task.title]);

  const commitEdit = useCallback((): void => {
    if (abortRef.current) {
      abortRef.current = false;
      setEditing(false);
      return;
    }
    setEditing(false);
    const next = draft.trim();
    if (next.length === 0 || next === task.title) return;
    actions.updateTask(task.id, { title: next });
  }, [actions, draft, task.id, task.title]);

  const handleToggle = useCallback((): void => {
    actions.toggleTask(task.id);
  }, [actions, task.id]);

  const showTraceChip = showTrace && goal !== null;
  const showCarried = task.carryCount > 1;
  const hasMeta = showTraceChip || showCarried;
  const showDateBadge = showDate && scheduled !== null;

  const dateTone = overdue ? 'red' : isTodayRow ? 'azure' : undefined;

  /* Built once and placed twice: below the title on narrow screens, in the
   * right rail once there is width for it. */
  const dateBadge =
    showDateBadge && scheduled !== null ? (
      <span className="pa-badge" data-tone={dateTone} data-tip={formatKey(scheduled, 'EEEE d MMMM')}>
        <CalendarDays className="size-3 shrink-0" aria-hidden="true" />
        {relativeDayLabel(scheduled, today)}
      </span>
    ) : null;

  /* The breadcrumb's contents, shared by the button and the inert variants. */
  const traceInner = goal ? (
    <>
      <Target className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="truncate">{goal.title}</span>
      {milestone ? (
        <>
          <ChevronRight className="size-3 shrink-0 opacity-45" aria-hidden="true" />
          <span className="truncate opacity-80">{milestone.title}</span>
        </>
      ) : null}
    </>
  ) : null;

  const traceTitle = goal
    ? milestone
      ? `Open goal: ${goal.title} › ${milestone.title}`
      : `Open goal: ${goal.title}`
    : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.18 } }}
      transition={{
        duration: 0.35,
        ease: [0.22, 1, 0.36, 1],
        delay: Math.min(index * 0.035, 0.3),
      }}
      className={clsx(
        'pa-row pa-row-hover group flex w-full items-center gap-3',
        dense ? 'min-h-[44px] px-2.5 py-1.5' : 'min-h-[52px] px-3 py-2',
        className,
      )}
      data-done={done ? 'true' : 'false'}
    >
      {/* ---- complete ---- */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        data-tip={done ? 'Mark as not done' : 'Complete'}
        onClick={handleToggle}
        className="pa-check"
        data-checked={done ? 'true' : 'false'}
        data-big3={ranked ? 'true' : 'false'}
      >
        <AnimatePresence initial={false}>
          {done ? (
            <motion.span
              key="tick"
              className="flex items-center justify-center"
              initial={reduce ? { opacity: 0 } : { scale: 0.35, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { scale: 0.35, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 24 }}
            >
              <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>

      {/* ---- title + meta ---- */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {ranked ? (
            <span
              className={clsx(
                'inline-flex shrink-0 items-center justify-center rounded-[0.4rem] tabular-nums leading-none',
                'size-[18px] text-[10.5px] text-[color:var(--pa-ink-accent)]',
                /* The wash alone is faint on the dark stage — the hairline ring
                 * is what keeps the rank readable as a chip in both themes. */
                'bg-[color:var(--pa-accent-bg)] shadow-[inset_0_0_0_1px_var(--pa-accent-ring)]',
              )}
              data-tip={`Big Three — number ${task.big3Rank}`}
            >
              <span className="sr-only">Big Three, number </span>
              {task.big3Rank}
            </span>
          ) : null}

          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(capitaliseOnType(event))}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitEdit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  abortRef.current = true;
                  setEditing(false);
                }
              }}
              aria-label={`Rename task "${task.title}"`}
              className={clsx(
                /* An INSET ring, never a border: the field has to occupy exactly
                 * the same box as the static title or the row twitches every
                 * time a rename opens. */
                '-mx-1 w-full min-w-0 rounded-md border-0 px-1 py-0.5',
                'bg-[color:var(--pa-accent-bg)] text-[color:var(--pa-navy)]',
                'caret-[color:var(--pa-azure)] outline-none',
                'ring-1 ring-inset ring-[color:var(--pa-accent-ring)]',
                dense ? 'text-[13px]' : 'text-[13.5px]',
              )}
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              data-tip="Click to rename"
              className={clsx(
                '-mx-1 min-w-0 max-w-full rounded-md px-1 py-0.5 text-left',
                /* Narrow screens have no room to ellipsis a title down to
                 * "Finish c…"; let it wrap to two lines there and collapse to a
                 * single truncated line once there is width to spare. No
                 * `block` before the sm breakpoint — it would beat the
                 * `-webkit-box` display that line-clamp needs. */
                'line-clamp-2 sm:block sm:line-clamp-none sm:truncate',
                'transition-colors duration-150',
                PILL_FOCUS,
                dense ? 'text-[13px]' : 'text-[13.5px]',
                done ? 'pa-struck' : 'text-[color:var(--pa-navy)]',
              )}
            >
              {task.title}
            </button>
          )}
        </div>

        {hasMeta || showDateBadge ? (
          <div
            className={clsx(
              'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1',
              dense ? 'mt-0.5' : 'mt-1',
              /* When the date is the only meta, this row exists purely to carry
               * it on narrow screens — above sm the badge lives in the right
               * rail instead, so the row would otherwise be an empty gap. */
              !hasMeta && 'sm:hidden',
            )}
          >
            {dateBadge ? <span className="sm:hidden">{dateBadge}</span> : null}

            {showTraceChip && goal ? (
              onOpenGoal ? (
                <button
                  type="button"
                  onClick={() => onOpenGoal(goal.id)}
                  data-tip={traceTitle}
                  className={clsx('pa-trace min-w-0 max-w-[22rem]', PILL_FOCUS)}
                >
                  {traceInner}
                </button>
              ) : (
                <span className="pa-trace min-w-0 max-w-[22rem]">{traceInner}</span>
              )
            ) : null}

            {showCarried ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 text-[11.5px] leading-none text-[color:var(--pa-faint)]"
                data-tip={`Rolled forward ${task.carryCount} times — is this task too big?`}
              >
                <RotateCcw className="size-3" aria-hidden="true" />
                carried {task.carryCount}&times;
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---- right rail ---- */}
      <div className="flex shrink-0 items-center gap-1">
        {dateBadge ? <span className="hidden sm:inline-flex">{dateBadge}</span> : null}

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => actions.cycleBig3(task.id)}
            aria-label={
              ranked ? `Remove "${task.title}" from the Big Three` : `Add "${task.title}" to the Big Three`
            }
            aria-pressed={ranked}
            data-tip={ranked ? 'Remove from Big Three' : 'Add to Big Three'}
            className={clsx(ACTION_BTN, ranked && 'opacity-100')}
            /* Inline so it survives `.pa-icon-btn:hover`, which is a more
             * specific selector than any utility class could be. */
            style={ranked ? { color: 'var(--pa-azure)' } : undefined}
          >
            <Star
              className="size-3.5"
              strokeWidth={1.9}
              fill={ranked ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
          </button>

          {!isTodayRow ? (
            <button
              type="button"
              onClick={() => actions.scheduleTask(task.id, today)}
              aria-label={`Move "${task.title}" to today`}
              data-tip="Move to today"
              className={ACTION_BTN}
            >
              <CalendarArrowDown className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => actions.deleteTask(task.id)}
            aria-label={`Delete "${task.title}"`}
            data-tip="Delete"
            data-danger="true"
            className={ACTION_BTN}
          >
            <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
