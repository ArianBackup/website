'use client';

/* ---------------------------------------------------------------------------
 * today-view.tsx — the daily driver.
 *
 * The one surface you open every morning, so it is deliberately calm: seven
 * panels, top to bottom, in the order the day is actually lived.
 *
 *   1. the hero      — the live clock, where today stands, what this week is for
 *   2. the Big Three — the three things that would make today count
 *   3. overdue       — only when there is something to answer for
 *   4. today's list  — everything else, with finished work folded away
 *   5. habits        — the rhythm underneath the plan
 *   6. the backlog   — a peek at what is waiting, never a demand
 *   7. the shutdown  — the thing you do once the day is spent
 *
 * THE LIVE DAY
 * ------------
 * The day comes from `useAssistant().today`, which the provider re-derives on
 * its own clock — so at local midnight this whole view rolls over to the new
 * day without a refresh. Nothing here captures the date at mount.
 *
 * COLOUR
 * ------
 * Every value on this page is a `--pa-*` token, so the view flips with
 * `data-pa-theme` without a single dark-mode branch. Where a wash needs to be
 * softer than the token it is derived from, it is `color-mix`ed down rather
 * than written out as a literal rgba — a literal would freeze that pixel in
 * its light-mode colour.
 *
 * Every number on this page is derived (lib/derive.ts) and every change goes
 * through `actions` — nothing here reaches into the document directly.
 * ------------------------------------------------------------------------- */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  ArrowRight,
  CalendarArrowDown,
  CalendarPlus,
  Check,
  ChevronRight,
  Flag,
  Layers,
  ListChecks,
  Moon,
  PenLine,
  Plus,
  Repeat,
  Star,
  Sunrise,
  Target,
  TriangleAlert,
} from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@web/components/ui/popover';
import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

import { capitaliseOnType } from '../../lib/capitalise';
import { formatKey, weekStartKey } from '../../lib/dates';
import {
  backlogTasks,
  big3ForDay,
  dayProgress,
  goalTrace,
  habitStreak,
  habitsDueOn,
  isHabitDone,
  overdueTasks,
  reviewStreak,
  tasksForDay,
} from '../../lib/derive';
import { iconFor } from '../../lib/icons';
import { useAssistant } from '../../lib/store';
import { FOCUS_QUICK_ADD_EVENT } from '../../lib/use-hotkeys';
import type { Habit, HabitCadence, Task, ViewId } from '../../lib/types';

import { START_DAILY_REVIEW_EVENT } from '../shared/command-palette';
import { EmptyState } from '../shared/empty-state';
import { LiveClock } from '../shared/live-clock';
import { Meter } from '../shared/meter';
import { ActivityHeatmap } from '../shared/activity-heatmap';
import { ProgressRing } from '../shared/progress-ring';
import { SectionHeader } from '../shared/section-header';
import { StreakChip } from '../shared/streak-chip';
import { TaskRow } from '../shared/task-row';
import { DailyShutdownDialog, GLASS_FOCUS } from './daily-shutdown-dialog';

/* -------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------- */

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** The shell mirrors its active view into `location.hash`; it also listens here. */
const NAVIGATE_EVENT = 'assistant:navigate';

/** Runs worth stopping for. */
const STREAK_MILESTONES = new Set([7, 30, 100]);

/** How much of the backlog Today is allowed to show. It is a peek, not a list. */
const BACKLOG_PEEK = 6;

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Neutralises `.assistant-shell`'s page geometry so the class can be reused as
 * a token carrier inside a Radix portal without claiming a whole viewport.
 */
const PORTAL_SHELL = { minHeight: 0, overflowX: 'visible' } as const;

/* The elevation ladder lives in CSS vars, and Tailwind reads `shadow-[var(…)]`
 * as a shadow COLOUR rather than a box-shadow, so it is applied directly. */
const SURFACE_SHADOW = { boxShadow: 'var(--pa-shadow-xl)' } as const;

/* The popover body. `.pa-sheet` is the same recipe at a dialog's 1.5rem, which
 * is far too round hanging off a task row — this is that recipe at the
 * popover's own radius: `--pa-solid` fill, `--pa-edge` lip, `--pa-shadow-xl`
 * lift. `overflow-hidden` is what makes the corner read as one clean curve,
 * because the header and footer sit flush against it. */
const POPOVER_SURFACE = clsx(
  'overflow-hidden rounded-[1.15rem] border',
  'border-[color:var(--pa-edge)] bg-[color:var(--pa-solid)]',
);

/** Azure bloom behind the hero clock. Built from the accent glow, which is
 *  deliberately stronger in dark mode — a wash that haloes on white would
 *  vanish entirely against the navy-black stage. */
const HERO_BLOOM: CSSProperties = {
  background:
    'radial-gradient(closest-side, var(--pa-accent-glow), color-mix(in srgb, var(--pa-accent-glow) 32%, transparent) 58%, transparent 78%)',
};

/** The one violet on the page: the light going off at the end of the day. */
const NIGHT_BLOOM: CSSProperties = {
  background:
    'radial-gradient(closest-side, color-mix(in srgb, var(--pa-violet) 18%, transparent), transparent 74%)',
};

/** Amber icon chip for the overdue panel — the only warm surface on the page. */
const AMBER_CHIP: CSSProperties = {
  background: 'var(--pa-amber-bg)',
  color: 'var(--pa-amber)',
  boxShadow:
    'inset 0 0 0 1px color-mix(in srgb, var(--pa-amber) 26%, transparent), var(--pa-highlight)',
};

const OVERDUE_EDGE: CSSProperties = {
  borderColor: 'color-mix(in srgb, var(--pa-amber) 30%, transparent)',
};

const OVERDUE_WASH: CSSProperties = {
  background: 'linear-gradient(155deg, var(--pa-amber-bg), transparent 64%)',
};

/** Hover lift on a habit tile: the accent wash at about half strength, so it
 *  reads as a hint on white and still registers on the dark stage. */
const HABIT_HOVER: CSSProperties = {
  background: 'color-mix(in srgb, var(--pa-accent-bg) 55%, transparent)',
  boxShadow: 'inset 0 0 0 1px var(--pa-accent-ring)',
};

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

function navigateTo(view: ViewId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { view } }));
  // The shell keeps the active view in the hash and follows `hashchange`, so
  // this works whether or not anything is listening for the event above.
  if (window.location.hash.replace(/^#/, '') !== view) window.location.hash = view;
}

function focusQuickAdd(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FOCUS_QUICK_ADD_EVENT));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** A habit's cadence, said the way a person would say it. */
function cadenceLabel(cadence: HabitCadence): string {
  if (cadence.type === 'timesPerWeek') {
    const target = Math.max(1, Math.trunc(cadence.target) || 1);
    return `${target}× a week`;
  }

  if (cadence.type === 'weekdays') {
    const days = Array.from(new Set(Array.isArray(cadence.days) ? cadence.days : []))
      .filter((day) => day >= 1 && day <= 7)
      .sort((a, b) => a - b);

    if (days.length === 0) return 'No days set';
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && days.every((day) => day <= 5)) return 'Weekdays';
    if (days.length === 2 && days[0] === 6 && days[1] === 7) return 'Weekends';
    return days.map((day) => WEEKDAY_LABELS[day - 1] ?? '').filter(Boolean).join(' · ');
  }

  return 'Every day';
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function TodayView(): JSX.Element {
  const { data, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [showCompleted, setShowCompleted] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(true);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const backlogRef = useRef<HTMLElement | null>(null);

  /* The command palette can start the shutdown from wherever you are; Today
   * mounts the same dialog the Review tab does, so it can answer here too. */
  useEffect(() => {
    const openShutdown = (): void => setShutdownOpen(true);
    window.addEventListener(START_DAILY_REVIEW_EVENT, openShutdown);
    return () => window.removeEventListener(START_DAILY_REVIEW_EVENT, openShutdown);
  }, []);

  /* ---- derived ---- */

  const todayTasks = useMemo(() => tasksForDay(data, today), [data, today]);
  const activeTasks = useMemo(
    () => todayTasks.filter((task) => task.completedAt === null),
    [todayTasks],
  );
  const completedTasks = useMemo(
    () => todayTasks.filter((task) => task.completedAt !== null),
    [todayTasks],
  );
  /* Three slots, each already carrying the breadcrumb it needs to render. */
  const big3 = useMemo<Big3Slot[]>(
    () =>
      big3ForDay(data, today).map((task, index) => {
        const rank = (index + 1) as 1 | 2 | 3;
        if (!task) return { rank, task: null, goalTitle: null, milestoneTitle: null };
        const trace = goalTrace(data, task);
        return {
          rank,
          task,
          goalTitle: trace.goal?.title ?? null,
          milestoneTitle: trace.milestone?.title ?? null,
        };
      }),
    [data, today],
  );

  const overdue = useMemo(() => overdueTasks(data, today), [data, today]);
  const habits = useMemo(() => habitsDueOn(data, today), [data, today]);
  const backlog = useMemo(() => backlogTasks(data), [data]);
  const progress = useMemo(() => dayProgress(data, today), [data, today]);

  const habitsDone = useMemo(
    () => habits.filter((habit) => isHabitDone(data.habitLogs, habit.id, today)).length,
    [habits, data.habitLogs, today],
  );

  const bestStreak = useMemo(
    () =>
      data.habits.reduce((best, habit) => {
        if (habit.archivedAt) return best;
        const { current } = habitStreak(data, habit.id, today);
        return current > best ? current : best;
      }, 0),
    [data, today],
  );

  /* Everything scheduled today that could still take a Big-3 slot. */
  const candidates = useMemo<Big3Candidate[]>(
    () =>
      todayTasks
        .filter((task) => task.big3Rank === null && task.completedAt === null)
        .map((task) => ({ task, goalTitle: goalTrace(data, task).goal?.title ?? null })),
    [todayTasks, data],
  );

  const weekFocus = (data.weeks[weekStartKey(today)]?.focus ?? '').trim();
  const backlogPeek = useMemo(() => backlog.slice(0, BACKLOG_PEEK), [backlog]);

  const tasksDone = completedTasks.length;
  const tasksTotal = todayTasks.length;
  const liveHabits = useMemo(() => data.habits.filter((habit) => !habit.archivedAt), [data.habits]);

  /* ---- the shutdown ---- */

  const shutdownWritten = useMemo(
    () => data.reviews.some((entry) => entry.type === 'daily' && entry.date === today),
    [data.reviews, today],
  );
  const reviewRun = useMemo(() => reviewStreak(data, today), [data, today]);

  /** One line that says where the day actually stands. */
  const shutdownLine = useMemo(() => {
    if (shutdownWritten) {
      return reviewRun > 1
        ? `Today is written down. ${reviewRun} days of shutdowns in a row.`
        : 'Today is written down. Come back tomorrow and make it two.';
    }

    if (progress.total === 0) {
      return 'Nothing was scheduled today. Two minutes of honesty still beats a blank page.';
    }

    const habitsLeft = habits.length - habitsDone;
    const tail =
      habitsLeft > 0 ? `, ${habitsLeft} ${plural(habitsLeft, 'habit', 'habits')} left` : '';
    return `${progress.done} of ${progress.total} done${tail}. Rate the day, keep the lesson, set tomorrow's three.`;
  }, [shutdownWritten, reviewRun, progress.total, progress.done, habits.length, habitsDone]);

  /** How today reads at a glance, under the clock. */
  const heroLine =
    progress.total === 0
      ? 'A blank day. Decide what would make it count.'
      : progress.ratio >= 1
        ? 'Everything on today is done. That is the whole list.'
        : `${progress.total - progress.done} ${plural(progress.total - progress.done, 'thing', 'things')} still standing between you and a finished day.`;

  /* ---- mutations ---- */

  const handleCarryOver = useCallback((): void => {
    const moved = actions.carryOverTo(today);
    if (moved === 0) {
      toast('Nothing left to move');
      return;
    }
    toast.success(`${moved} ${plural(moved, 'task', 'tasks')} moved to today`, {
      description: 'Rolled forward from earlier days.',
    });
  }, [actions, today]);

  const handleCompleteBig3 = useCallback(
    (task: Task, rank: 1 | 2 | 3): void => {
      const becameComplete = actions.toggleTask(task.id);
      if (!becameComplete) return;
      // The feedback is the toast and every meter that watches this task
      // moving. Nothing fires, nothing flashes.
      toast.success(`Priority ${rank} done`, { description: task.title });
    },
    [actions],
  );

  const handleAssignBig3 = useCallback(
    (task: Task, rank: 1 | 2 | 3): void => {
      actions.updateTask(task.id, { big3Rank: rank });
      toast.success(`Priority ${rank} set`, { description: task.title });
    },
    [actions],
  );

  const handleClearBig3 = useCallback(
    (task: Task): void => {
      actions.cycleBig3(task.id);
      toast('Removed from the Big Three', { description: task.title });
    },
    [actions],
  );

  const handleToggleHabit = useCallback(
    (habit: Habit): void => {
      const before = habitStreak(data, habit.id, today);
      const logged = actions.toggleHabit(habit.id, today);
      if (!logged) return;

      // A week-based streak counts weeks, so a day cannot tip it over a
      // milestone; only daily / weekday habits get the moment.
      const weekly = habit.cadence?.type === 'timesPerWeek';
      const projected = before.doneToday ? before.current : before.current + 1;
      if (weekly || !STREAK_MILESTONES.has(projected)) return;

      toast.success(`${projected} days of ${habit.name}`, {
        description: 'A real streak now. Protect it.',
      });
    },
    [actions, data, today],
  );

  const handleScheduleToday = useCallback(
    (task: Task): void => {
      actions.scheduleTask(task.id, today);
      toast.success('Moved to today', { description: task.title });
    },
    [actions, today],
  );

  const handleOpenBacklog = useCallback((): void => {
    setBacklogOpen(true);
    window.requestAnimationFrame(() => {
      backlogRef.current?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }, [reduce]);

  /* ---- entrance ---- */

  const rise = useCallback(
    (index: number) => ({
      initial: { opacity: 0, y: reduce ? 0 : 12 },
      animate: { opacity: 1, y: 0 },
      transition: {
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      },
    }),
    [reduce],
  );

  return (
    <div className="space-y-5">
      {/* ================= 1. hero =================
          The clock is the centrepiece, so the panel's own decoration steps
          back: no `.pa-sheen` here any more (a sweep across rolling numerals
          reads as two animations fighting), just a static azure bloom behind
          the dial. */}
      <motion.section
        {...rise(0)}
        aria-labelledby="pa-today-heading"
        className="pa-panel relative overflow-hidden p-5 sm:p-7"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full"
          style={HERO_BLOOM}
        />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          {/* ---- the clock, then the day, then the week ---- */}
          <div className="min-w-0 flex-1">
            <p className="pa-eyebrow">{formatKey(today, 'EEEE')}</p>

            {/* The visible date is the clock's own caption ("Monday, 1 August ·
                6 hours left today"), which is live down to the minute. This
                heading exists so the section has a real accessible name and a
                screen reader hears the year too. */}
            <h2 id="pa-today-heading" className="sr-only">
              {formatKey(today, 'EEEE d MMMM yyyy')}
            </h2>

            <LiveClock variant="hero" className="mt-3.5" />

            <p className="mt-5 max-w-[46ch] text-[13.5px] leading-relaxed text-[color:var(--pa-muted)]">
              {heroLine}
            </p>

            {/* The pinned note. It was a read-only echo of the week's focus
                with a "THIS WEEK" label over it and a jump to the Week view;
                it is now the field itself, edited in place. The label is gone
                — a note you write does not need telling what it is — and the
                italic is kept, because that is what made it read as a quote to
                yourself rather than as another row of UI. */}
            <div className="mt-6 max-w-[48ch]">
              <HeroNote
                value={weekFocus}
                onCommit={(next) => actions.setWeekFocus(weekStartKey(today), next)}
              />
            </div>
          </div>

          {/* ---- the day's readout ----
              Stacked under the clock on a phone, beside it from `sm`, and back
              into a column in the hero's right rail once there is room. The
              month graph always spans the full rail underneath, at every size —
              it is the one thing here that needs its width. */}
          <div className="flex w-full shrink-0 flex-col gap-4 lg:w-auto lg:min-w-[288px]">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5 lg:flex-col lg:gap-4">
              <ProgressRing value={progress.ratio} size={108} stroke={8} sublabel="Today" />

              <div className="grid w-full grid-cols-3 gap-2 sm:flex-1 lg:w-full lg:flex-none">
                <HeroStat label="Tasks">
                  <p className="text-[15px] tabular-nums leading-none text-[color:var(--pa-navy)]">
                    {tasksDone}
                    <span className="text-[color:var(--pa-faint)]">/{tasksTotal}</span>
                  </p>
                </HeroStat>
                <HeroStat label="Habits">
                  <p className="text-[15px] tabular-nums leading-none text-[color:var(--pa-navy)]">
                    {habitsDone}
                    <span className="text-[color:var(--pa-faint)]">/{habits.length}</span>
                  </p>
                </HeroStat>
                <HeroStat label="Streak">
                  <StreakChip count={bestStreak} />
                </HeroStat>
              </div>
            </div>

            {/* The month as a contribution graph — a cell per day, shaded by how
                much got closed out, with the run-up behind it for scale. */}
            <ActivityHeatmap />

          </div>
        </div>
      </motion.section>

      {/* ================= 2. the Big Three ================= */}
      <motion.section {...rise(1)} className="pa-panel p-5 sm:p-6">
        <SectionHeader
          eyebrow="Today's priorities"
          title="The Big Three"
          subtitle="Three things that would make today a win. Everything else is a bonus, not a debt."
          icon={Star}
        />

        <div className="mt-5 space-y-2.5">
          {big3.map((slot, index) =>
            slot.task ? (
              <Big3FilledSlot
                key={slot.task.id}
                task={slot.task}
                rank={slot.rank}
                index={index}
                goalTitle={slot.goalTitle}
                milestoneTitle={slot.milestoneTitle}
                onComplete={handleCompleteBig3}
                onClear={handleClearBig3}
              />
            ) : (
              <Big3EmptySlot
                key={`pa-big3-slot-${slot.rank}`}
                rank={slot.rank}
                index={index}
                candidates={candidates}
                onAssign={handleAssignBig3}
                onCapture={focusQuickAdd}
              />
            ),
          )}
        </div>
      </motion.section>

      {/* ================= 3. overdue ================= */}
      {overdue.length > 0 ? (
        <motion.section
          {...rise(2)}
          className="pa-panel relative overflow-hidden p-5 sm:p-6"
          style={OVERDUE_EDGE}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0" style={OVERDUE_WASH} />

          <div className="relative flex flex-wrap items-start justify-between gap-x-5 gap-y-4">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[0.85rem]"
                style={AMBER_CHIP}
                aria-hidden
              >
                <TriangleAlert className="size-[18px]" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p
                  className="pa-eyebrow mb-1.5 leading-none"
                  style={{ color: 'var(--pa-amber)' }}
                >
                  Still open
                </p>
                <h2 className="pa-title text-[17px] leading-snug">Overdue</h2>
                <p className="mt-1 max-w-[58ch] text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
                  {overdue.length} {plural(overdue.length, 'task', 'tasks')} from earlier days never
                  got finished. Pull them forward, or let them go.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="pa-badge" data-tone="amber">
                {overdue.length} overdue
              </span>
              <button
                type="button"
                onClick={handleCarryOver}
                className="pa-cta pa-focus h-9 px-3.5 text-[13px]"
              >
                <CalendarArrowDown className="size-3.5" strokeWidth={1.9} aria-hidden />
                Move all to today
              </button>
            </div>
          </div>

          <div className="relative mt-5 space-y-2">
            <AnimatePresence initial={false}>
              {overdue.map((task, index) => (
                <TaskRow key={task.id} task={task} index={index} showDate showTrace />
              ))}
            </AnimatePresence>
          </div>
        </motion.section>
      ) : null}

      {/* ================= 4. today's tasks ================= */}
      <motion.section {...rise(3)} className="pa-panel p-5 sm:p-6">
        <SectionHeader
          eyebrow="The list"
          title="Today's tasks"
          subtitle={
            tasksTotal === 0
              ? 'Nothing on the day yet.'
              : `${tasksDone} of ${tasksTotal} done — the rest is still yours.`
          }
          icon={ListChecks}
          action={
            tasksTotal > 0 ? (
              <div className="hidden w-32 sm:block">
                <p className="mb-1.5 text-right text-[11.5px] tabular-nums leading-none text-[color:var(--pa-faint)]">
                  {Math.round((tasksDone / tasksTotal) * 100)}%
                </p>
                <Meter value={tasksDone / tasksTotal} thin />
              </div>
            ) : null
          }
        />

        {tasksTotal === 0 ? (
          <EmptyState
            icon={Sunrise}
            title="Nothing scheduled"
            description="Capture your first task above, or pull something in from your backlog."
            action={
              backlog.length > 0 ? (
                <>
                  <GlassButton
                    className="glass-button--haze-light"
                    size="none"
                    type="button"
                    buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                    contentClassName={GLASS_BOX.h10.content}
                    onClick={handleOpenBacklog}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Layers className="size-4" aria-hidden="true" />
                      Pull from backlog
                    </span>
                  </GlassButton>
                  <button
                    type="button"
                    onClick={focusQuickAdd}
                    className="pa-cta pa-focus h-10 px-4 text-[13.5px]"
                  >
                    <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                    Capture a task
                  </button>
                </>
              ) : (
                <GlassButton
                  className="glass-button--haze-light"
                  size="none"
                  type="button"
                  buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                  contentClassName={GLASS_BOX.h10.content}
                  onClick={focusQuickAdd}
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus className="size-4" aria-hidden="true" />
                    Capture a task
                  </span>
                </GlassButton>
              )
            }
          />
        ) : (
          <>
            <div className="mt-5 space-y-2">
              <AnimatePresence initial={false}>
                {activeTasks.map((task, index) => (
                  <TaskRow key={task.id} task={task} index={index} showTrace dense={false} />
                ))}
              </AnimatePresence>

              {activeTasks.length === 0 ? (
                <div className="pa-well flex items-center justify-center gap-2.5 px-4 py-7 text-center">
                  <span className="pa-chip size-7 rounded-[0.6rem]" aria-hidden>
                    <Check className="size-3.5" strokeWidth={2.25} />
                  </span>
                  <p className="text-[13px] text-[color:var(--pa-muted)]">
                    Every task on today is done. Close the laptop.
                  </p>
                </div>
              ) : null}
            </div>

            {/* inline capture */}
            <button
              type="button"
              onClick={focusQuickAdd}
              className="pa-row pa-row-hover pa-focus group mt-2 flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left"
            >
              <span
                aria-hidden
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-[0.5rem] border border-dashed border-[color:var(--pa-faint)] text-[color:var(--pa-faint)] transition-colors duration-200 group-hover:border-[color:var(--pa-accent-border)] group-hover:text-[color:var(--pa-ink-accent)]"
              >
                <Plus className="size-3" strokeWidth={2.25} />
              </span>
              <span className="text-[13.5px] text-[color:var(--pa-faint)] transition-colors duration-200 group-hover:text-[color:var(--pa-muted)]">
                Add a task&hellip;
              </span>
              <kbd className="ml-auto hidden rounded-[0.4rem] border border-[color:var(--pa-line)] bg-[color:var(--pa-tile)] px-1.5 py-px font-sans text-[10.5px] font-medium text-[color:var(--pa-faint)] sm:inline-block">
                Q
              </kbd>
            </button>

            {completedTasks.length > 0 ? (
              <div className="mt-4">
                <hr className="pa-divider" />
                <button
                  type="button"
                  onClick={() => setShowCompleted((open) => !open)}
                  aria-expanded={showCompleted}
                  className="pa-btn pa-focus mt-3 h-8 px-2.5 text-[12.5px]"
                >
                  <motion.span
                    className="inline-flex"
                    animate={{ rotate: showCompleted ? 90 : 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.2, ease: HOUSE_EASE }}
                    aria-hidden
                  >
                    <ChevronRight className="size-3.5" strokeWidth={2} />
                  </motion.span>
                  {completedTasks.length} completed
                </button>

                <AnimatePresence initial={false}>
                  {showCompleted ? (
                    <motion.div
                      key="pa-completed"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: HOUSE_EASE }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-2 pt-3">
                        {completedTasks.map((task, index) => (
                          <TaskRow key={task.id} task={task} index={index} showTrace />
                        ))}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : null}
          </>
        )}
      </motion.section>

      {/* ================= 5. habits ================= */}
      <motion.section {...rise(4)} className="pa-panel p-5 sm:p-6">
        <SectionHeader
          eyebrow="The rhythm"
          title="Habits due today"
          subtitle="The small things that compound while the big things are still in progress."
          icon={Repeat}
          action={
            habits.length > 0 ? (
              <span className="pa-badge" data-tone={habitsDone === habits.length ? 'green' : 'azure'}>
                {habitsDone}/{habits.length} logged
              </span>
            ) : null
          }
        />

        {habits.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={liveHabits.length === 0 ? 'No habits yet' : 'Nothing due today'}
            description={
              liveHabits.length === 0
                ? 'Habits carry the days motivation does not. Add one and it will show up here on its own schedule.'
                : 'Every habit you keep is resting today. A planned rest day never breaks a streak.'
            }
            action={
              liveHabits.length === 0 ? (
                <button
                  type="button"
                  onClick={() => navigateTo('habits')}
                  className="pa-cta pa-focus h-10 px-4 text-[13.5px]"
                >
                  <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                  Build a habit
                </button>
              ) : null
            }
          />
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {habits.map((habit, index) => (
              <HabitTile
                key={habit.id}
                habit={habit}
                index={index}
                done={isHabitDone(data.habitLogs, habit.id, today)}
                streak={habitStreak(data, habit.id, today).current}
                onToggle={handleToggleHabit}
              />
            ))}
          </div>
        )}
      </motion.section>

      {/* ================= 6. backlog peek ================= */}
      {backlog.length > 0 ? (
        <motion.section {...rise(5)} ref={backlogRef} className="pa-panel p-5 sm:p-6">
          <SectionHeader
            eyebrow="Unscheduled"
            title="Waiting in the backlog"
            subtitle="Work with no date on it. Pull in only what today can actually hold."
            icon={Layers}
            action={
              <button
                type="button"
                onClick={() => setBacklogOpen((open) => !open)}
                aria-expanded={backlogOpen}
                className="pa-btn pa-focus h-8 px-2.5 text-[12.5px]"
              >
                {backlogOpen ? 'Hide' : `Show ${backlog.length}`}
                <motion.span
                  className="inline-flex"
                  animate={{ rotate: backlogOpen ? 90 : 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.2, ease: HOUSE_EASE }}
                  aria-hidden
                >
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </motion.span>
              </button>
            }
          />

          <AnimatePresence initial={false}>
            {backlogOpen ? (
              <motion.div
                key="pa-backlog"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: HOUSE_EASE }}
                className="overflow-hidden"
              >
                <div className="pa-well mt-5 space-y-1.5 p-2.5">
                  {backlogPeek.map((task, index) => (
                    <div key={task.id} className="flex min-w-0 items-center gap-2">
                      <TaskRow task={task} index={index} dense showTrace className="min-w-0 flex-1" />
                      <button
                        type="button"
                        onClick={() => handleScheduleToday(task)}
                        aria-label={`Schedule "${task.title}" for today`}
                        className="pa-cta pa-focus h-8 shrink-0 px-3 text-[12px]"
                      >
                        <CalendarPlus className="size-3.5" strokeWidth={1.9} aria-hidden />
                        Today
                      </button>
                    </div>
                  ))}
                </div>

                {backlog.length > BACKLOG_PEEK ? (
                  <div className="mt-3 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => navigateTo('week')}
                      className="pa-btn pa-focus h-8 px-3 text-[12px]"
                    >
                      {backlog.length - BACKLOG_PEEK} more in the backlog
                      <ArrowRight className="size-3.5" strokeWidth={1.9} aria-hidden />
                    </button>
                  </div>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.section>
      ) : null}

      {/* ================= 7. the shutdown =================
          Last on the page because it is last in the day: everything above is
          what you do, this is what you do once it is spent. The Review tab
          mounts the same dialog — whichever surface opens it, it is the same
          entry for the same date. */}
      <motion.section {...rise(6)} className="pa-panel relative overflow-hidden p-5 sm:p-6">
        {shutdownWritten ? null : (
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -right-16 size-64 rounded-full"
            style={NIGHT_BLOOM}
          />
        )}

        <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="pa-chip mt-0.5 size-9 shrink-0" aria-hidden>
              <Moon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="pa-eyebrow mb-1.5 leading-none">
                {shutdownWritten ? 'Day closed' : 'When the day is done'}
              </p>
              <h2 className="pa-title text-[17px] leading-snug">Daily shutdown</h2>
              <p className="mt-1 max-w-[58ch] text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
                {shutdownLine}
              </p>
            </div>
          </div>

          {/* `self-center`, against the row's `items-start`. The block on the
              left is three lines and a chip and this is one button, so
              top-aligning both left it 25px below the panel's top edge and 47px
              above the bottom — close enough to centred to read as a mistake
              rather than as an alignment. The row keeps `items-start` for the
              text block itself, whose icon has to sit level with its first
              line, not with the middle of the paragraph.

              A no-op once the row wraps: each block is then its own flex line
              and there is no spare cross-axis room to centre within. */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 self-center">
            {shutdownWritten ? (
              <>
                <span className="pa-badge" data-tone="green">
                  <Check className="size-3" strokeWidth={2.5} aria-hidden />
                  Done
                </span>
                <StreakChip count={reviewRun} />
              </>
            ) : null}

            <GlassButton
              className="glass-button--haze-light shrink-0"
              size="none"
              type="button"
              buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
              contentClassName={GLASS_BOX.h10.content}
              onClick={() => setShutdownOpen(true)}
            >
              {/* The shared GlassButton inherits the host app's blue label
                  colour, which is the last blue lettering left on the dark
                  stage. Set on the span, so it beats the inherited value
                  outright rather than by specificity. */}
              <span className="inline-flex items-center gap-2 text-[color:var(--pa-navy)]">
                {shutdownWritten ? (
                  <PenLine className="size-4" aria-hidden="true" />
                ) : (
                  <Moon className="size-4" aria-hidden="true" />
                )}
                {shutdownWritten ? "Edit today's shutdown" : 'Close the day'}
              </span>
            </GlassButton>
          </div>
        </div>
      </motion.section>

      <DailyShutdownDialog open={shutdownOpen} onOpenChange={setShutdownOpen} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Hero note — the one line you want in front of you, edited in place.
 *
 * A borderless textarea that looks like the italic quote it replaced: no label,
 * no chrome until you touch it, and it grows with what you type rather than
 * scrolling inside a fixed box.
 *
 * COMMITTING ON BLUR, NOT ON EVERY KEYSTROKE
 * ------------------------------------------
 * The store snapshots the whole document on every dispatch, and the undo stack
 * is fifty deep. Writing per keystroke would mean one sentence typed here
 * spends the entire history, so an undo afterwards walks back a letter at a
 * time and anything that happened before it is gone. Blur is the commit, so a
 * note is one step. Escape abandons the edit; the store keeps whatever it had.
 *
 * THE BULLETS ARE TEXT
 * --------------------
 * A textarea holds a string, not a document, so there is no per-line box to
 * hang a marker off. The two alternatives were both worse than putting the
 * character in the text: a repeating background gradient pinned to the
 * line-height draws a bullet against every VISUAL line, so a wrapped item
 * sprouts a second one; and a mirrored overlay has to re-measure wrapping on
 * every keystroke to stay aligned.
 *
 * So the field's own text carries "• " at the head of each line, and Enter
 * opens the next line with one already there. The store never sees them:
 * `fieldToValue` strips them on the way in, `valueToField` puts them back on
 * the way out, and neither runs during typing — re-deriving a textarea's value
 * mid-keystroke is what makes carets jump to the end.
 * ---------------------------------------------------------------------- */

const NOTE_PLACEHOLDER = 'Anything you want in front of you…';

const BULLET = '•';

/** Any of the marks a person might type themselves, so we do not double them. */
const LEADING_MARK = /^\s*[••\-*]\s*/;

/** Stored lines → what the field shows. */
function valueToField(value: string): string {
  const lines = value.split('\n').map((line) => line.replace(LEADING_MARK, '').trim());
  const kept = lines.filter((line) => line.length > 0);
  return kept.map((line) => `${BULLET} ${line}`).join('\n');
}

/** What the field shows → what the store keeps: plain lines, no marks, no gaps. */
function fieldToValue(field: string): string {
  return field
    .split('\n')
    .map((line) => line.replace(LEADING_MARK, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export interface HeroNoteProps {
  value: string;
  onCommit: (next: string) => void;
}

function HeroNote({ value, onCommit }: HeroNoteProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() => valueToField(value));

  /* Follow the store when it moves underneath us — an undo, a weekly review,
   * or the same document edited in another tab. Skipped while the field has
   * focus, so a sync can never overwrite what is being typed. */
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setDraft(valueToField(value));
  }, [value]);

  /* Height tracks content. Reset to `auto` first or the box can only ever grow:
   * scrollHeight is clamped by the height already set. */
  const resize = useCallback((): void => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  useEffect(resize, [resize, draft]);

  /* Escape reverts and then blurs, and blur is what commits — but `setDraft` is
   * async, so the commit that blur triggers still closes over the EDITED draft
   * and writes exactly what Escape was meant to throw away. The flag is read on
   * the way through instead of trying to race the state update. */
  const abandonRef = useRef(false);

  const commit = useCallback((): void => {
    if (abandonRef.current) {
      abandonRef.current = false;
      return;
    }
    const next = fieldToValue(draft);
    if (next !== fieldToValue(value)) onCommit(next);
  }, [draft, value, onCommit]);

  /**
   * Types `text` at the caret and leaves the caret after it.
   *
   * The DOM is written first and the caret set in the same tick, and only then
   * is React told. Deferring the caret to a frame later — which is the obvious
   * way to write this — loses a race against fast typing: the next keystroke
   * lands before the restore runs, and the restore then puts the caret at a
   * position computed from a selection that has already moved. Typing "Book"
   * straight after Enter came out as "ook…B".
   *
   * Writing `node.value` before `setDraft` is what makes it safe: by the time
   * React re-renders, the DOM already holds the value it is about to set, so it
   * skips the write and leaves the selection alone.
   */
  const typeAtCaret = useCallback((text: string): void => {
    const node = ref.current;
    if (!node) return;
    const { selectionStart, selectionEnd, value: current } = node;
    const next = current.slice(0, selectionStart) + text + current.slice(selectionEnd);
    const at = selectionStart + text.length;
    node.value = next;
    node.setSelectionRange(at, at);
    setDraft(next);
  }, []);

  return (
    <div className="group relative -mx-2 flex items-start gap-3 rounded-[1rem] px-2 py-1.5 transition-colors duration-200 focus-within:bg-[color:var(--pa-hover-wash)] hover:bg-[color:var(--pa-hover-wash)]">
      <span className="pa-chip mt-0.5 size-8 shrink-0 rounded-[0.7rem]" aria-hidden>
        <Flag className="size-4" strokeWidth={1.75} />
      </span>
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        onChange={(event) => setDraft(capitaliseOnType(event))}
        onFocus={() => {
          // An empty note opens with the first bullet already set, so the shape
          // of the thing is obvious before a single character is typed.
          if (draft.length === 0) typeAtCaret(`${BULLET} `);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            abandonRef.current = true;
            setDraft(valueToField(value));
            event.currentTarget.blur();
            return;
          }
          // Enter opens the next line with its bullet. Shift+Enter is left to
          // the browser, for a soft break inside one item.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            typeAtCaret(`\n${BULLET} `);
          }
        }}
        placeholder={NOTE_PLACEHOLDER}
        aria-label="Pinned note"
        spellCheck={false}
        className={clsx(
          'min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none',
          'text-[13.5px] italic leading-relaxed text-[color:var(--pa-muted)]',
          'placeholder:not-italic placeholder:text-[color:var(--pa-faint)]',
        )}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Hero stat — one compact figure under the ring.
 * ---------------------------------------------------------------------- */

export interface HeroStatProps {
  label: string;
  children: ReactNode;
}

function HeroStat({ label, children }: HeroStatProps): JSX.Element {
  return (
    <div className="pa-tile flex min-w-0 flex-col items-center justify-center gap-2 px-2 py-2.5">
      <p className="text-[9.5px] uppercase leading-none tracking-[0.13em] text-[color:var(--pa-faint)]">
        {label}
      </p>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Big Three — a filled slot.
 * ---------------------------------------------------------------------- */

/** One of the three slots, resolved: either a ranked task or an opening. */
export interface Big3Slot {
  rank: 1 | 2 | 3;
  task: Task | null;
  goalTitle: string | null;
  milestoneTitle: string | null;
}

export interface Big3FilledSlotProps {
  task: Task;
  rank: 1 | 2 | 3;
  index: number;
  goalTitle: string | null;
  milestoneTitle: string | null;
  onComplete: (task: Task, rank: 1 | 2 | 3) => void;
  onClear: (task: Task) => void;
}

/** The checkbox is scaled up here; `.pa-check` fixes its own box in CSS. */
const BIG_CHECK: CSSProperties = { width: '1.5rem', height: '1.5rem', borderRadius: '0.6rem' };

function Big3FilledSlot({
  task,
  rank,
  index,
  goalTitle,
  milestoneTitle,
  onComplete,
  onClear,
}: Big3FilledSlotProps): JSX.Element {
  const reduce = useReducedMotion();
  const done = task.completedAt !== null;

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: done ? 0.85 : 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      className="pa-tile group flex items-center gap-3.5 px-4 py-3.5"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        data-tip={done ? 'Mark as not done' : 'Complete'}
        onClick={() => onComplete(task, rank)}
        className="pa-check"
        style={BIG_CHECK}
        data-checked={done ? 'true' : 'false'}
        data-big3="true"
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
              <Check className="size-4" strokeWidth={3} aria-hidden />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>

      <span
        className={clsx('pa-avatar size-9 text-[14px] tabular-nums', done && 'opacity-55')}
        aria-hidden
      >
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            'line-clamp-2 sm:line-clamp-none sm:truncate text-[15px] leading-snug',
            done ? 'pa-struck' : 'text-[color:var(--pa-navy)]',
          )}
        >
          {task.title}
        </p>

        {goalTitle ? (
          <span className="pa-trace mt-1.5 max-w-full">
            <Target className="size-3 shrink-0" strokeWidth={2} aria-hidden />
            <span className="truncate">{goalTitle}</span>
            {milestoneTitle ? (
              <>
                <ChevronRight className="size-3 shrink-0 opacity-45" aria-hidden />
                <span className="truncate opacity-80">{milestoneTitle}</span>
              </>
            ) : null}
          </span>
        ) : (
          <p className="mt-1 text-[11.5px] leading-none text-[color:var(--pa-faint)]">
            Priority {rank} for today
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onClear(task)}
        aria-label={`Remove "${task.title}" from the Big Three`}
        data-tip="Remove from the Big Three"
        className="pa-icon-btn pa-focus size-8 shrink-0 opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
      >
        <Star className="size-4" strokeWidth={1.9} fill="currentColor" aria-hidden />
      </button>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
 * Big Three — an empty slot and its picker.
 * ---------------------------------------------------------------------- */

export interface Big3Candidate {
  task: Task;
  goalTitle: string | null;
}

export interface Big3EmptySlotProps {
  rank: 1 | 2 | 3;
  index: number;
  candidates: Big3Candidate[];
  onAssign: (task: Task, rank: 1 | 2 | 3) => void;
  onCapture: () => void;
}

function Big3EmptySlot({
  rank,
  index,
  candidates,
  onAssign,
  onCapture,
}: Big3EmptySlotProps): JSX.Element {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);

  const entrance = {
    initial: { opacity: 0, y: reduce ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.35,
      ease: HOUSE_EASE,
      delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
    },
  };

  const empty = candidates.length === 0;

  const trigger = (
    <button
      type="button"
      /* With nothing to rank the slot stops being a picker and becomes the
         shortest route to the capture bar. */
      onClick={empty ? onCapture : undefined}
      className="pa-drop pa-focus group relative flex w-full items-center gap-3.5 overflow-hidden px-4 py-3.5 text-left"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[color:var(--pa-accent-bg)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      <span
        aria-hidden
        className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-[color:var(--pa-faint)] text-[14px] tabular-nums text-[color:var(--pa-faint)] transition-colors duration-200 group-hover:border-[color:var(--pa-accent-border)] group-hover:text-[color:var(--pa-ink-accent)]"
      >
        {rank}
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-snug text-[color:var(--pa-muted)]">
          {empty ? `Capture your #${rank} priority` : `Choose your #${rank} priority`}
        </span>
        <span className="mt-1 block truncate text-[11.5px] leading-none text-[color:var(--pa-faint)]">
          {empty
            ? 'Nothing unranked on today — capture something new'
            : `${candidates.length} ${plural(candidates.length, 'task', 'tasks')} on today to pick from`}
        </span>
      </span>
      <Plus
        className="relative size-4 shrink-0 text-[color:var(--pa-faint)] transition-colors duration-200 group-hover:text-[color:var(--pa-ink-accent)]"
        strokeWidth={1.9}
        aria-hidden
      />
    </button>
  );

  if (empty) return <motion.div {...entrance}>{trigger}</motion.div>;

  return (
    <motion.div {...entrance}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>

        {/* `pa-portal` strips the host kit's fill, border, shadow and
            `rounded-lg` off the portal container — that second, squarer
            rectangle around our surface was the doubled corner. The surface
            below now owns every pixel, and its `overflow-hidden` clips the
            header and footer so they cannot square it off again. */}
        <PopoverContent
          align="start"
          sideOffset={8}
          className={clsx(
            'pa-portal',
            'w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[440px]',
            'border-0 bg-transparent p-0 shadow-none',
          )}
        >
          <div className="assistant-shell" style={PORTAL_SHELL}>
            <div className={POPOVER_SURFACE} style={SURFACE_SHADOW}>
              <div className="border-b border-[color:var(--pa-line-soft)] px-4 py-3">
                <p className="pa-eyebrow leading-none">Priority {rank}</p>
                <p className="mt-1.5 text-[12.5px] leading-snug text-[color:var(--pa-muted)]">
                  Pick one of today&rsquo;s unranked tasks.
                </p>
              </div>

              <div className="max-h-[min(46dvh,300px)] overflow-y-auto p-1.5">
                {candidates.map(({ task, goalTitle }) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => {
                      onAssign(task, rank);
                      setOpen(false);
                    }}
                    className="pa-focus flex w-full items-center gap-2.5 rounded-[0.75rem] px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[color:var(--pa-accent-bg)]"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full bg-[color:var(--pa-azure)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[color:var(--pa-navy)]">
                        {task.title}
                      </span>
                      {goalTitle ? (
                        <span className="mt-0.5 block truncate text-[11px] text-[color:var(--pa-faint)]">
                          {goalTitle}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>

              <div className="border-t border-[color:var(--pa-line-soft)] px-2 py-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onCapture();
                  }}
                  className="pa-focus flex w-full items-center gap-2.5 rounded-[0.75rem] px-2.5 py-2 text-left text-[12.5px] text-[color:var(--pa-muted)] transition-colors duration-150 hover:bg-[color:var(--pa-accent-bg)]"
                >
                  <Plus className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  Capture something new instead
                </button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
 * Habits
 * ---------------------------------------------------------------------- */

export interface HabitTileProps {
  habit: Habit;
  done: boolean;
  streak: number;
  index: number;
  onToggle: (habit: Habit) => void;
}

function HabitTile({ habit, done, streak, index, onToggle }: HabitTileProps): JSX.Element {
  const reduce = useReducedMotion();
  const Icon = iconFor(habit.icon);

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={done}
      aria-label={
        done ? `Mark "${habit.name}" as not done today` : `Mark "${habit.name}" as done today`
      }
      onClick={() => onToggle(habit)}
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: done ? 0.72 : 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      className="pa-tile pa-focus group relative flex w-full items-center gap-3 overflow-hidden p-3.5 text-left"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={HABIT_HOVER}
      />

      <span
        className={clsx('relative size-9 shrink-0 rounded-[0.8rem]', done ? 'pa-chip-solid' : 'pa-chip')}
        aria-hidden
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>

      <span className="relative min-w-0 flex-1">
        <span
          className={clsx(
            'block truncate text-[13.5px] leading-snug',
            done ? 'text-[color:var(--pa-muted)]' : 'text-[color:var(--pa-navy)]',
          )}
        >
          {habit.name}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <span className="truncate text-[11.5px] leading-none text-[color:var(--pa-faint)]">
            {cadenceLabel(habit.cadence)}
          </span>
          <StreakChip count={streak} />
        </span>
      </span>

      <span
        className="pa-check relative"
        data-checked={done ? 'true' : 'false'}
        aria-hidden
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
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
