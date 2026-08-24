'use client';

/* ---------------------------------------------------------------------------
 * brief-header.tsx — the operating panel, once you scroll past the header.
 *
 * The full header is three bands of chrome. Scroll it away and this takes over
 * in the left gutter, and it is deliberately NOT a smaller copy of that header:
 * the switcher is gone, because the tabs are still two hundred pixels up and a
 * second copy of them is a second thing to maintain and no new information.
 *
 * What is here instead is the state of the day, live, and the two things you
 * can actually do about it without going anywhere:
 *
 *   ring, clock, date  where today stands, and when today is
 *   undo / redo        the two controls that scrolled away with the header
 *   the Big Three      tickable, in place
 *   habits             tickable, in place
 *   overdue            only when there is something to answer for
 *
 * Your name is not on it. This card is a gutter wide and it spends that width
 * on things that move; the name was the one line that never did. The date it
 * used to sit beside is still here, but as a line under the clock rather than
 * as a badge — read there it belongs to the time instead of labelling the card.
 *
 * Everything reads through the same derivations the Today view uses, so a tick
 * here and a tick there are the same tick — there is no second source of truth
 * hiding in the corner.
 *
 * WHY A SECOND ELEMENT RATHER THAN ONE THAT MORPHS
 * ------------------------------------------------
 * A shared-element morph (motion's `layoutId`) would carry the mark from one
 * layout to the other, and it is the obvious first idea. It needs the two to
 * never be mounted at once, and here they always are: the full header stays in
 * the document, scrolled above the fold, for the whole time this is on screen.
 * Two live elements under one `layoutId` fight over the same projection and the
 * result reads as a flicker, not a morph.
 *
 * So it is two elements and a crossfade — the real header scrolling up and out
 * while this slides in from the left. What sells it is that they are never both
 * legible at the same moment: the trigger is the header leaving the viewport.
 * ------------------------------------------------------------------------- */

import { useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { Check, Flame, Redo2, TriangleAlert, Undo2 } from 'lucide-react';

import { formatKey } from '../lib/dates';
import {
  big3ForDay,
  dayProgress,
  habitStreak,
  habitsDueOn,
  isHabitDone,
  overdueTasks,
  tasksForDay,
} from '../lib/derive';
import { iconFor } from '../lib/icons';
import { useAssistant } from '../lib/store';
import type { ViewId } from '../lib/types';

import { LiveClock } from './shared/live-clock';
import { ProgressRing } from './shared/progress-ring';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** The shell mirrors its active view into `location.hash`; it also listens. */
const NAVIGATE_EVENT = 'assistant:navigate';

/** Habits shown as dots. Past this the row wraps and stops reading as a rhythm. */
const HABIT_DOTS = 8;

function navigateTo(view: ViewId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { view } }));
  if (window.location.hash.replace(/^#/, '') !== view) window.location.hash = view;
}

export interface BriefHeaderProps {
  /** True once the full header has left the viewport. */
  open: boolean;
}

export function BriefHeader({ open }: BriefHeaderProps): JSX.Element {
  const { data, today, canUndo, canRedo, actions } = useAssistant();
  const reduce = useReducedMotion();

  /* The header's own pair scrolls away with it, and this is the surface that
   * replaces it — so the two controls that undo a mistaken tick have to be
   * within reach of the ticks themselves. */
  const handleUndo = (): void => {
    if (actions.undo()) toast.success('Change undone');
  };
  const handleRedo = (): void => {
    if (actions.redo()) toast.success('Change redone');
  };

  const state = useMemo(() => {
    const progress = dayProgress(data, today);
    const remaining = tasksForDay(data, today).filter((t) => t.completedAt === null).length;
    const habits = habitsDueOn(data, today);
    const habitsDone = habits.filter((h) => isHabitDone(data.habitLogs, h.id, today)).length;
    const streak = data.habits.reduce((best, habit) => {
      if (habit.archivedAt) return best;
      const { current } = habitStreak(data, habit.id, today);
      return current > best ? current : best;
    }, 0);

    return {
      ratio: progress.ratio,
      remaining,
      big3: big3ForDay(data, today),
      habits,
      habitsDone,
      streak,
      overdue: overdueTasks(data, today).length,
    };
  }, [data, today]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="brief"
          className="pa-brief pa-panel"
          aria-label="Today, condensed"
          initial={{ opacity: 0, x: reduce ? 0 : -14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduce ? 0 : -14 }}
          transition={{ duration: 0.28, ease: HOUSE_EASE }}
        >
          {/* ---- the day, and the two controls ----
              Wraps rather than crushes. The gutter at 1440 is 134px wide and
              the ring alone is 66 of it, so on the narrowest screens each of
              these three lands on its own line.

              That only happens because the text column declares a basis. On
              `min-w-0 flex-1` it never wraps — flex reads that as "shrink to
              nothing before pushing anyone to the next line" — so it took the
              22px left over beside the ring and the clock, whose digit cells
              are sized in `ch` and cannot shrink, simply drew past the edge of
              the card. The basis is the narrowest width the three lines below
              still read at; under that, wrapping is the better answer. */}
          <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2">
            <ProgressRing value={state.ratio} size={66} stroke={5.5} className="shrink-0" />
            <div className="min-w-0 grow basis-[7.5rem]">
              <LiveClock variant="compact" className="pa-brief-clock" />
              {/* The compact clock is digits only — the date the hero variant
                  prints under its numerals is the hero's own caption, so this
                  row has to carry its own. `EEE d MMM` over the full weekday
                  and month: at the narrowest gutter the card is barely wider
                  than the ring, and "Sunday 2 August" would truncate to
                  something that reads as a bug. */}
              <time
                dateTime={today}
                className="mt-1.5 block truncate text-[13px] font-medium leading-none text-[color:var(--pa-muted)]"
              >
                {formatKey(today, 'EEE d MMM')}
              </time>
              <p className="mt-2 truncate text-[14px] leading-none text-[color:var(--pa-faint)]">
                <span className="tabular-nums text-[color:var(--pa-muted)]">{state.remaining}</span>{' '}
                left
                {state.streak > 0 ? (
                  <span className="ml-2.5 inline-flex items-center gap-1 align-middle">
                    <Flame className="size-4 text-[color:var(--pa-flame-ink)]" strokeWidth={2} />
                    <span className="tabular-nums text-[color:var(--pa-muted)]">
                      {state.streak}
                    </span>
                  </span>
                ) : null}
              </p>
            </div>

            {/* Kept as a pair even when one is dead, so the corner never
                reflows as the two stacks fill and empty. */}
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                data-tip={canUndo ? 'Undo last change' : 'Nothing to undo'}
                aria-label={canUndo ? 'Undo last change' : 'Nothing to undo'}
                className={clsx(
                  'pa-brief-ctrl pa-focus',
                  !canUndo && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                )}
              >
                <Undo2 className="size-[18px]" strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                data-tip={canRedo ? 'Redo last change' : 'Nothing to redo'}
                aria-label={canRedo ? 'Redo last change' : 'Nothing to redo'}
                className={clsx(
                  'pa-brief-ctrl pa-focus',
                  !canRedo && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                )}
              >
                <Redo2 className="size-[18px]" strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>

          {/* ---- the Big Three, tickable ---- */}
          <div className="pa-brief-rule" />
          <p className="pa-brief-label">Big Three</p>
          <ul className="mt-2 space-y-1">
            {state.big3.map((task, index) => {
              const done = task?.completedAt !== null && task !== null;
              return (
                <li key={task?.id ?? `slot-${index}`}>
                  {task ? (
                    <button
                      type="button"
                      onClick={() => actions.toggleTask(task.id)}
                      className="pa-brief-row pa-focus"
                      aria-pressed={done}
                      data-tip={task.title}
                    >
                      <span className="pa-brief-tick" data-done={done} aria-hidden>
                        {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                      </span>
                      <span
                        className={clsx(
                          'min-w-0 flex-1 truncate',
                          done && 'line-through opacity-55',
                        )}
                      >
                        {task.title}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigateTo('today')}
                      className="pa-brief-row pa-focus opacity-60"
                    >
                      <span className="pa-brief-tick" data-empty aria-hidden>
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[color:var(--pa-faint)]">
                        Nothing set
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* ---- habits, tickable ---- */}
          {state.habits.length > 0 ? (
            <>
              <div className="pa-brief-rule" />
              <div className="flex items-baseline justify-between gap-2">
                <p className="pa-brief-label">Habits</p>
                <p className="text-[12px] tabular-nums text-[color:var(--pa-faint)]">
                  {state.habitsDone}/{state.habits.length}
                </p>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {state.habits.slice(0, HABIT_DOTS).map((habit) => {
                  const done = isHabitDone(data.habitLogs, habit.id, today);
                  const Icon = iconFor(habit.icon);
                  return (
                    <button
                      key={habit.id}
                      type="button"
                      onClick={() => actions.toggleHabit(habit.id, today)}
                      className="pa-brief-habit pa-focus"
                      data-done={done}
                      aria-pressed={done}
                      data-tip={habit.name}
                      aria-label={`${habit.name}${done ? ', done today' : ''}`}
                    >
                      <Icon className="size-3.5" strokeWidth={2} aria-hidden />
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {/* ---- and the one thing that is not going well ---- */}
          {state.overdue > 0 ? (
            <>
              <div className="pa-brief-rule" />
              <button
                type="button"
                onClick={() => navigateTo('today')}
                className="pa-brief-alert pa-focus"
              >
                <TriangleAlert className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                <span className="tabular-nums">{state.overdue}</span>
                <span className="min-w-0 truncate">overdue</span>
              </button>
            </>
          ) : null}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
