'use client';

/* ---------------------------------------------------------------------------
 * habits-view.tsx — THE COMPOUNDING HALF.
 *
 * Goals are decided; habits are kept. This surface is built around that
 * difference, so nothing here is a to-do list:
 *
 *   1. the header      how many habits are live, and how today is going
 *   2. the today strip every habit due today as one row of toggles, so the
 *                      whole day can be cleared without scrolling
 *   3. the cards       one habit at a time — cadence, streak, thirty-day
 *                      reliability and half a year of history
 *
 * The order of the cards is the argument: anything still asking for attention
 * today floats to the top, and below that the longest running streaks — the
 * ones with the most to lose — come first.
 *
 * Everything is derived (lib/derive.ts) and every change goes through
 * `actions.*`; this file owns presentation and nothing else.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import {
  Check,
  Minus,
  PencilLine,
  Plus,
  Repeat,
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
  type CSSProperties,
  type FormEvent,
} from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

import { capitaliseOnType } from '../../lib/capitalise';
import { formatKey } from '../../lib/dates';
import {
  habitConsistency,
  habitLogDays,
  habitStreak,
  habitsDueOn,
  isHabitDone,
} from '../../lib/derive';
import { ICON_CHOICES, iconFor } from '../../lib/icons';
import { useAssistant } from '../../lib/store';
import type {
  DayKey,
  Goal,
  Habit,
  HabitCadence,
  HabitStreak,
  ID,
  LifeArea,
} from '../../lib/types';

import { OPEN_GOAL_EVENT } from '../shared/command-palette';
import { EmptyState } from '../shared/empty-state';
import { GoalPicker } from '../shared/goal-picker';
import { HabitHeatmap } from '../shared/habit-heatmap';
import { Meter } from '../shared/meter';
import { SectionHeader } from '../shared/section-header';
import { StreakChip } from '../shared/streak-chip';
import { GLASS_FOCUS } from './daily-shutdown-dialog';

/* -------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------- */

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** The shell mirrors its active view into `location.hash`; it also listens here. */
const NAVIGATE_EVENT = 'assistant:navigate';

/** Long enough for the workspace's view cross-fade to have mounted the target. */
const VIEW_SWITCH_MS = 380;

/** Runs worth stopping for. */
const STREAK_MILESTONES = new Set([7, 30, 100]);

/** History drawn under every habit. Half a year reads as a habit, a month doesn't. */
const HEATMAP_WEEKS = 26;

/** The window the reliability meter measures. */
const CONSISTENCY_DAYS = 30;

/** An armed delete that is then ignored disarms itself. */
const CONFIRM_MS = 4000;

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Neutralises `.assistant-shell`'s page geometry inside a Radix portal. */
const PORTAL_SHELL = { minHeight: 0, overflowX: 'visible' } as const;

/* The one rounded sheet the composer is made of. `.pa-sheet` carries the
 * radius, the near-opaque `--pa-solid` fill, the lit edge and the layered
 * elevation, so nothing here re-states them; `overflow-hidden` is what stops
 * the header and footer squaring off the corners they sit flush against. */
const SURFACE = 'pa-sheet flex max-h-[min(88dvh,900px)] flex-col overflow-hidden';

/* The portal container is stripped back to a bare positioning box by
 * `pa-portal` (see the reset at the foot of assistant.css); these classes only
 * decide how wide and how transparent that box is. */
const CONTENT = clsx(
  'block w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] gap-0',
  'border-0 bg-transparent p-0 shadow-none',
);

/* The scrim renders outside `.assistant-shell`, where the `--pa-*` tokens do
 * not resolve — so it is a deep navy black that reads as a modal dim on the
 * light stage and as a deepening on the dark one. */
const OVERLAY = 'bg-[rgba(8,20,44,0.44)] backdrop-blur-[3px]';

/** Keeps a pill's shape while focused, which `.pa-focus` would square off. */
const PILL_FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--pa-accent-ring)]';

/** The quiet bordered pill used for every secondary decision. */
const QUIET_PILL = clsx(
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4',
  'border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)]',
  'text-[13px] font-medium text-[color:var(--pa-muted)]',
  'transition-colors duration-150',
  'hover:border-[color:var(--pa-accent-border)] hover:bg-[color:var(--pa-row-hover)]',
  'hover:text-[color:var(--pa-navy)]',
  PILL_FOCUS,
);

/** The unselected state of every square/pill choice in the composer. */
const CHOICE_IDLE = clsx(
  'border-[color:var(--pa-line)] bg-[color:var(--pa-tile)] text-[color:var(--pa-muted)]',
  'hover:border-[color:var(--pa-accent-ring)] hover:bg-[color:var(--pa-row-hover)]',
  'hover:text-[color:var(--pa-navy)]',
);

/** The selected state of the same. */
const CHOICE_ACTIVE = clsx(
  'border-[color:var(--pa-accent-border)] bg-[color:var(--pa-accent-bg)]',
  'text-[color:var(--pa-navy)]',
);

/* A lit corner behind a header. `--pa-accent-glow` is deliberately stronger in
 * dark mode: a wash that reads as a bloom on white vanishes entirely against
 * the navy-black stage. */
const HEADER_BLOOM =
  'radial-gradient(closest-side, var(--pa-accent-glow), ' +
  'color-mix(in srgb, var(--pa-accent-glow) 32%, transparent) 58%, transparent 78%)';

const FIELD_LABEL =
  'mb-2 block text-[11px] font-medium uppercase tracking-[0.11em] text-[color:var(--pa-faint)]';

const MICRO_LABEL =
  'text-[10px] font-medium uppercase leading-none tracking-[0.11em] text-[color:var(--pa-faint)]';

/* `.pa-check` fixes its own 1.25rem box in CSS, and a Tailwind size utility
 * would lose the specificity fight — so the card's hero toggle is sized inline
 * rather than scaled with a transform, which would soften its 1.5px border. */
const BIG_CHECK: CSSProperties = {
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: '0.68rem',
};

/** The red wash on an armed delete. */
const ARMED_DELETE: CSSProperties = {
  background: 'var(--pa-red-bg)',
  color: 'var(--pa-red)',
};

/* -------------------------------------------------------------------------
 * Small pure helpers
 * ---------------------------------------------------------------------- */

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** ISO weekday numbers, de-duplicated, in range and in week order. */
function normaliseDays(days: readonly number[] | undefined): number[] {
  if (!Array.isArray(days)) return [];
  return Array.from(new Set(days))
    .filter((day) => Number.isFinite(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b);
}

function clampTarget(target: number): number {
  if (!Number.isFinite(target)) return 3;
  return Math.min(7, Math.max(1, Math.trunc(target) || 1));
}

/** A habit's cadence, said the way a person would say it. */
function cadenceLabel(cadence: HabitCadence): string {
  if (cadence.type === 'timesPerWeek') {
    return `${clampTarget(cadence.target)}× per week`;
  }

  if (cadence.type === 'weekdays') {
    const days = normaliseDays(cadence.days);
    if (days.length === 0) return 'No days set';
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && days.every((day) => day <= 5)) return 'Weekdays';
    if (days.length === 2 && days[0] === 6 && days[1] === 7) return 'Weekends';
    return days
      .map((day) => WEEKDAY_LABELS[day - 1] ?? '')
      .filter((label) => label.length > 0)
      .join(', ');
  }

  return 'Every day';
}

/**
 * Sends the workspace to the Goals view and asks it to open one goal.
 * The event is dispatched after the cross-fade so the listener exists.
 */
function openGoalInGoals(goalId: ID): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { view: 'goals' } }));
  if (window.location.hash.replace(/^#/, '') !== 'goals') window.location.hash = 'goals';
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(OPEN_GOAL_EVENT, { detail: { goalId } }));
  }, VIEW_SWITCH_MS);
}

/* -------------------------------------------------------------------------
 * The view model
 * ---------------------------------------------------------------------- */

export interface HabitCardModel {
  habit: Habit;
  /** The habit's own life area, falling back to its goal's. */
  area: LifeArea | null;
  goal: Goal | null;
  streak: HabitStreak;
  /** Logged ÷ due across the last thirty days, 0–1. */
  ratio30: number;
  /** Every day this habit was ever logged, for the heatmap. */
  logDays: Set<DayKey>;
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function HabitsView(): JSX.Element {
  /* `today` is the provider's live day: it moves on its own at midnight, so the
   * today strip empties and refills, every streak is recounted and the heatmaps
   * step a column along without anyone reloading the page. */
  const { data, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<ID | null>(null);

  /* ---- derived ---- */

  const liveHabits = useMemo<Habit[]>(
    () => data.habits.filter((habit) => !habit.archivedAt).sort((a, b) => a.order - b.order),
    [data.habits],
  );

  const dueHabits = useMemo<Habit[]>(() => habitsDueOn(data, today), [data, today]);

  const dueDone = useMemo<number>(
    () => dueHabits.filter((habit) => isHabitDone(data.habitLogs, habit.id, today)).length,
    [dueHabits, data.habitLogs, today],
  );

  /** Thirty-day reliability for every live habit, keyed by id. */
  const consistency = useMemo<Map<ID, number>>(() => {
    const map = new Map<ID, number>();
    for (const row of habitConsistency(data, CONSISTENCY_DAYS, today)) {
      map.set(row.habitId, row.ratio);
    }
    return map;
  }, [data, today]);

  const cards = useMemo<HabitCardModel[]>(() => {
    const rows = liveHabits.map((habit): HabitCardModel => {
      const goal =
        habit.goalId === null ? null : (data.goals.find((g) => g.id === habit.goalId) ?? null);
      const areaId = habit.areaId ?? goal?.areaId ?? null;

      return {
        habit,
        area: areaId === null ? null : (data.areas.find((a) => a.id === areaId) ?? null),
        goal,
        streak: habitStreak(data, habit.id, today),
        ratio30: consistency.get(habit.id) ?? 0,
        logDays: habitLogDays(data, habit.id),
      };
    });

    /* Still owed today first, then the runs with the most to lose. */
    return rows.sort((a, b) => {
      const owedA = a.streak.dueToday ? 0 : 1;
      const owedB = b.streak.dueToday ? 0 : 1;
      if (owedA !== owedB) return owedA - owedB;
      if (a.streak.current !== b.streak.current) return b.streak.current - a.streak.current;
      return a.habit.order - b.habit.order;
    });
  }, [liveHabits, data, today, consistency]);

  /* ---- interactions ---- */

  const handleToggle = useCallback(
    (habit: Habit): void => {
      const before = habitStreak(data, habit.id, today);
      const logged = actions.toggleHabit(habit.id, today);
      if (!logged) return;

      // A week-based streak counts weeks, so a single day cannot tip it over a
      // milestone; only daily / weekday habits get the moment.
      const weekly = habit.cadence.type === 'timesPerWeek';
      const projected = before.doneToday ? before.current : before.current + 1;
      if (weekly || !STREAK_MILESTONES.has(projected)) return;

      toast.success(`${projected} days of ${habit.name}`, {
        description: 'A real streak now. Protect it.',
      });
    },
    [actions, data, today],
  );

  const handleEdit = useCallback((habitId: ID): void => {
    setEditingId(habitId);
    setComposerOpen(true);
  }, []);

  const handleCreate = useCallback((): void => {
    setEditingId(null);
    setComposerOpen(true);
  }, []);

  const handleDelete = useCallback(
    (habit: Habit): void => {
      actions.deleteHabit(habit.id);
      toast.success('Habit deleted', {
        description: `${habit.name} — its logged days went with it.`,
      });
    },
    [actions],
  );

  /* ---- copy ---- */

  const hasHabits = liveHabits.length > 0;
  const allDone = dueHabits.length > 0 && dueDone === dueHabits.length;
  const dueTone = dueHabits.length === 0 ? undefined : allDone ? 'green' : 'azure';

  const subtitle = hasHabits
    ? `${liveHabits.length} live ${plural(liveHabits.length, 'habit', 'habits')} · ${
        dueHabits.length === 0
          ? 'nothing due today'
          : `${dueDone} of ${dueHabits.length} logged today`
      }`
    : 'The compounding half of the system — small, repeatable, tied to a goal.';

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* =============================================================
          1 — header
          ============================================================= */}
      <motion.section
        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: HOUSE_EASE }}
        className="pa-panel p-5 sm:p-6"
      >
        <SectionHeader
          eyebrow="Consistency"
          title="Habits"
          subtitle={subtitle}
          icon={Repeat}
          /* One primary per surface: while the shelf is empty the empty state
           * below carries the hero button, so the header stays quiet. */
          action={
            hasHabits ? (
              <GlassButton
                className="glass-button--haze-light shrink-0"
                size="none"
                type="button"
                buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                contentClassName={GLASS_BOX.h10.content}
                onClick={handleCreate}
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="size-4" aria-hidden="true" />
                  New habit
                </span>
              </GlassButton>
            ) : null
          }
        />
      </motion.section>

      {/* =============================================================
          2 — today strip
          ============================================================= */}
      {hasHabits ? (
        <motion.section
          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.05 }}
          className="pa-panel p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="pa-eyebrow leading-none">Today</h2>
            <span className="text-[11.5px] leading-none text-[color:var(--pa-faint)]">
              {formatKey(today, 'EEEE d MMM')}
            </span>
            <span className="pa-divider hidden flex-1 sm:block" aria-hidden="true" />
            <span className="pa-badge" data-tone={dueTone}>
              {dueHabits.length === 0 ? 'Nothing due' : `${dueDone} of ${dueHabits.length} done`}
            </span>
          </div>

          {dueHabits.length === 0 ? (
            <div className="pa-well mt-4 px-4 py-5 text-center">
              <p className="text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
                Nothing is due today.
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--pa-faint)]">
                Every habit you keep is resting — a scheduled rest day never breaks a streak.
              </p>
            </div>
          ) : (
            <>
              <Meter value={dueDone / dueHabits.length} complete={allDone} className="mt-3.5" />

              <div className="mt-4 flex flex-wrap gap-2">
                <AnimatePresence initial={false}>
                  {dueHabits.map((habit, index) => (
                    <HabitTodayChip
                      key={habit.id}
                      habit={habit}
                      done={isHabitDone(data.habitLogs, habit.id, today)}
                      index={index}
                      reduce={Boolean(reduce)}
                      onToggle={handleToggle}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </>
          )}
        </motion.section>
      ) : null}

      {/* =============================================================
          3 — the cards
          ============================================================= */}
      {hasHabits ? (
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
          <AnimatePresence initial={false}>
            {cards.map((card, index) => (
              <HabitCard
                key={card.habit.id}
                card={card}
                index={index}
                refDay={today}
                reduce={Boolean(reduce)}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onOpenGoal={openGoalInGoals}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <section className="pa-panel p-5 sm:p-6">
          <EmptyState
            icon={Repeat}
            title="No habits yet"
            description="Habits are the compounding half of the system — small, repeatable, tied to a goal."
            action={
              <GlassButton
                className="glass-button--haze-light"
                size="none"
                type="button"
                buttonClassName={clsx(GLASS_BOX.h11.button, GLASS_FOCUS)}
                contentClassName={GLASS_BOX.h11.content}
                onClick={handleCreate}
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="size-4" aria-hidden="true" />
                  Build your first habit
                </span>
              </GlassButton>
            }
          />
        </section>
      )}

      <HabitComposerDialog
        open={composerOpen}
        habitId={editingId}
        onOpenChange={(open) => {
          setComposerOpen(open);
          if (!open) setEditingId(null);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Today chip — the whole day, clearable from one row
 * ---------------------------------------------------------------------- */

export interface HabitTodayChipProps {
  habit: Habit;
  done: boolean;
  index: number;
  reduce: boolean;
  onToggle: (habit: Habit) => void;
}

function HabitTodayChip({
  habit,
  done,
  index,
  reduce,
  onToggle,
}: HabitTodayChipProps): JSX.Element {
  const Icon = iconFor(habit.icon);

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={done}
      aria-label={
        done ? `Mark "${habit.name}" as not done today` : `Mark "${habit.name}" as done today`
      }
      data-tip={cadenceLabel(habit.cadence)}
      onClick={() => onToggle(habit)}
      layout={reduce ? false : 'position'}
      initial={{ opacity: 0, y: reduce ? 0 : 10, scale: reduce ? 1 : 0.96 }}
      animate={{ opacity: done ? 0.74 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: reduce ? 1 : 0.94 }}
      transition={{
        duration: 0.3,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.03, 0.24),
      }}
      className={clsx(
        'group inline-flex h-9 items-center gap-2 rounded-full border pl-1.5 pr-3',
        'transition-colors duration-200',
        PILL_FOCUS,
        done
          ? 'border-[color:var(--pa-accent-ring)] bg-[color:var(--pa-accent-bg)]'
          : clsx(
              'border-[color:var(--pa-line)] bg-[color:var(--pa-tile)]',
              'hover:border-[color:var(--pa-accent-border)] hover:bg-[color:var(--pa-row-hover)]',
            ),
      )}
    >
      <span
        className={clsx('size-6 shrink-0', done ? 'pa-chip-solid' : 'pa-chip')}
        style={{ borderRadius: '999px' }}
        aria-hidden="true"
      >
        <Icon className="size-3" strokeWidth={1.9} />
      </span>

      <span
        className={clsx(
          'max-w-[18ch] truncate text-[12.5px] leading-none',
          done ? 'text-[color:var(--pa-muted)]' : 'text-[color:var(--pa-navy)]',
        )}
      >
        {habit.name}
      </span>

      <span
        aria-hidden="true"
        className={clsx(
          'flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors duration-200',
          done
            ? /* on the brand gradient, white stays white in both themes */
              'text-white'
            : clsx(
                'border border-[color:var(--pa-faint)] bg-[color:var(--pa-tile)]',
                'group-hover:border-[color:var(--pa-accent-border)]',
              ),
        )}
        style={done ? { background: 'var(--pa-grad)' } : undefined}
      >
        <AnimatePresence initial={false}>
          {done ? (
            <motion.span
              key="tick"
              className="flex items-center justify-center"
              initial={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 24 }}
            >
              <Check className="size-3" strokeWidth={3} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

/* -------------------------------------------------------------------------
 * Habit card
 * ---------------------------------------------------------------------- */

export interface HabitCardProps {
  card: HabitCardModel;
  index: number;
  refDay: DayKey;
  reduce: boolean;
  onToggle: (habit: Habit) => void;
  onEdit: (habitId: ID) => void;
  onDelete: (habit: Habit) => void;
  onOpenGoal: (goalId: ID) => void;
}

function HabitCard({
  card,
  index,
  refDay,
  reduce,
  onToggle,
  onEdit,
  onDelete,
  onOpenGoal,
}: HabitCardProps): JSX.Element {
  const { habit, area, goal, streak, ratio30, logDays } = card;
  const Icon = iconFor(habit.icon);

  const [confirming, setConfirming] = useState(false);

  /* An armed delete that is then ignored disarms itself. */
  useEffect(() => {
    if (!confirming) return undefined;
    const timer = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const done = streak.doneToday;
  const owed = streak.dueToday;
  const scheduled = done || owed;
  const percent30 = Math.round(ratio30 * 100);

  /* An area's colour is data and stands on either theme; the fallback is the
   * brand token, which brightens in dark mode. `color-mix` is what lets the two
   * share one code path — a var() cannot take a hex alpha suffix. */
  const accent = area ? area.color : 'var(--pa-azure)';
  const cornerWash = done
    ? 'radial-gradient(closest-side, var(--pa-accent-glow), transparent 72%)'
    : `radial-gradient(closest-side, color-mix(in srgb, ${accent} 14%, transparent), transparent 72%)`;

  const remove = (): void => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onDelete(habit);
  };

  /* The entrance lives on a wrapper, never on `.pa-card` itself: motion leaves
   * an inline transform behind, and an inline transform beats the `:hover`
   * rule that gives the card its lift. */
  return (
    <motion.div
      layout={reduce ? false : 'position'}
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -8 }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      className="min-w-0"
    >
      <article
        className={clsx(
          'pa-card group relative flex h-full flex-col overflow-hidden p-[18px]',
          done && 'outline outline-2 outline-offset-2 outline-[color:var(--pa-accent-ring)]',
        )}
      >
        {/* A breath of colour in the corner so the card sits in light, not on paper. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-14 size-40 rounded-full transition-opacity duration-300"
          style={{ background: cornerWash }}
        />

        {/* ---- identity + today's toggle ---- */}
        <div className="relative flex items-start gap-3">
          <span
            className={clsx('size-10 shrink-0', done ? 'pa-chip-solid' : 'pa-chip')}
            aria-hidden="true"
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </span>

          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="truncate text-[15px] font-medium leading-snug tracking-tight text-[color:var(--pa-navy)]">
              {habit.name}
            </h3>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] leading-none text-[color:var(--pa-faint)]">
              <Repeat className="size-3 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              <span className="truncate">{cadenceLabel(habit.cadence)}</span>
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={done}
            aria-label={
              done
                ? `Mark "${habit.name}" as not done today`
                : `Mark "${habit.name}" as done today`
            }
            data-tip={
              scheduled
                ? undefined
                : 'Not scheduled for today — logging it anyway still counts'
            }
            onClick={() => onToggle(habit)}
            className={clsx(
              'pa-focus -m-1 shrink-0 rounded-[0.85rem] p-1',
              'transition-opacity duration-200',
              scheduled ? 'opacity-100' : 'opacity-40 hover:opacity-90',
            )}
          >
            <span
              className="pa-check"
              style={BIG_CHECK}
              data-checked={done ? 'true' : 'false'}
              aria-hidden="true"
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
                    <Check className="size-4" strokeWidth={3} />
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </span>
          </button>
        </div>

        {/* ---- the three numbers ---- */}
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <div className="pa-tile flex flex-col gap-2 px-3 py-2.5">
            <p className={MICRO_LABEL}>Streak</p>
            <StreakChip count={streak.current} className="self-start" />
          </div>

          <MiniStat label="Best" value={streak.best} unit={plural(streak.best, 'day', 'days')} />
          <MiniStat
            label="Total"
            value={streak.total}
            unit={plural(streak.total, 'day', 'days')}
          />
        </div>

        {/* ---- reliability ---- */}
        <div className="relative mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11.5px] leading-none text-[color:var(--pa-faint)]">
              Last {CONSISTENCY_DAYS} days
            </p>
            <p className="text-[12px] font-medium tabular-nums leading-none text-[color:var(--pa-muted)]">
              {percent30}%
            </p>
          </div>
          <Meter value={ratio30} thin className="mt-2" />
        </div>

        {/* ---- history ---- */}
        <div className="relative mt-4">
          <p className={clsx(MICRO_LABEL, 'mb-2')}>Last {HEATMAP_WEEKS} weeks</p>
          <HabitHeatmap days={logDays} weeks={HEATMAP_WEEKS} endDay={refDay} />
        </div>

        {/* ---- footer ---- */}
        <div className="relative mt-auto pt-4">
          <span className="pa-divider block" aria-hidden="true" />

          <div className="mt-3.5 flex items-center gap-2">
            {goal ? (
              <button
                type="button"
                onClick={() => onOpenGoal(goal.id)}
                data-tip={`Open goal: ${goal.title}`}
                className={clsx('pa-trace min-w-0', PILL_FOCUS)}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: accent }}
                />
                <span className="truncate">{goal.title}</span>
              </button>
            ) : area ? (
              <span className="pa-badge min-w-0">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: area.color }}
                />
                <span className="truncate">{area.name}</span>
              </span>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-[color:var(--pa-faint)]">
                <Target className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                Not linked to a goal
              </span>
            )}

            <span className="flex-1" aria-hidden="true" />

            <div
              className={clsx(
                'flex shrink-0 items-center gap-1 transition-opacity duration-200',
                confirming
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100',
              )}
            >
              <button
                type="button"
                onClick={() => onEdit(habit.id)}
                aria-label={`Edit habit: ${habit.name}`}
                data-tip="Edit habit"
                className="pa-icon-btn pa-focus size-7"
              >
                <PencilLine className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={remove}
                data-danger="true"
                aria-label={
                  confirming
                    ? `Confirm deleting habit: ${habit.name}`
                    : `Delete habit: ${habit.name}`
                }
                data-tip={confirming ? 'Click again to delete' : 'Delete habit'}
                style={confirming ? ARMED_DELETE : undefined}
                className={clsx(
                  'pa-icon-btn pa-focus inline-flex h-7 items-center gap-1.5',
                  confirming ? 'px-2' : 'w-7 justify-center',
                )}
              >
                <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                <AnimatePresence initial={false}>
                  {confirming ? (
                    <motion.span
                      key="confirm"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, width: 0 }}
                      transition={{ duration: 0.18, ease: HOUSE_EASE }}
                      className="overflow-hidden whitespace-nowrap text-[11.5px] font-medium leading-none"
                    >
                      Confirm
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </button>
            </div>
          </div>
        </div>
      </article>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
 * Mini stat — the two plain numerals beside the streak chip
 * ---------------------------------------------------------------------- */

export interface MiniStatProps {
  label: string;
  value: number;
  unit: string;
}

function MiniStat({ label, value, unit }: MiniStatProps): JSX.Element {
  return (
    <div className="pa-tile flex flex-col gap-2 px-3 py-2.5">
      <p className={MICRO_LABEL}>{label}</p>
      <p className="flex items-baseline gap-1 leading-none">
        <span className="text-[14px] font-medium tabular-nums text-[color:var(--pa-navy)]">
          {value}
        </span>
        <span className="text-[11px] text-[color:var(--pa-faint)]">{unit}</span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Composer — create and edit share one form
 * ---------------------------------------------------------------------- */

type CadenceType = HabitCadence['type'];

const CADENCE_OPTIONS: { id: CadenceType; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'timesPerWeek', label: 'Times per week' },
];

interface Draft {
  name: string;
  icon: string;
  cadenceType: CadenceType;
  /** ISO weekday numbers for the `weekdays` cadence. */
  days: number[];
  /** Target for the `timesPerWeek` cadence. */
  target: number;
  areaId: ID | null;
  goalId: ID | null;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  icon: 'Sparkles',
  cadenceType: 'daily',
  days: [1, 2, 3, 4, 5],
  target: 3,
  areaId: null,
  goalId: null,
};

function draftFrom(habit: Habit): Draft {
  const cadence = habit.cadence;
  return {
    name: habit.name,
    icon: habit.icon,
    cadenceType: cadence.type,
    days: cadence.type === 'weekdays' ? normaliseDays(cadence.days) : EMPTY_DRAFT.days,
    target: cadence.type === 'timesPerWeek' ? clampTarget(cadence.target) : EMPTY_DRAFT.target,
    areaId: habit.areaId,
    goalId: habit.goalId,
  };
}

export interface HabitComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` composes a new habit; an id edits that one. */
  habitId?: ID | null;
}

function HabitComposerDialog({
  open,
  onOpenChange,
  habitId = null,
}: HabitComposerDialogProps): JSX.Element {
  const { data, actions } = useAssistant();
  const reduce = useReducedMotion();
  const fieldId = useId();

  /* Snapshotted at open time so the header keeps its identity through the
   * closing animation, even once the parent has cleared the id. */
  const [editing, setEditing] = useState<Habit | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [showError, setShowError] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  /* Each opening starts from the truth, not from whatever was typed last time. */
  useEffect(() => {
    if (!open) return;
    const target = habitId === null ? null : (data.habits.find((h) => h.id === habitId) ?? null);
    setEditing(target);
    setDraft(target ? draftFrom(target) : EMPTY_DRAFT);
    setShowError(false);
    // `data` is intentionally read only at open time — a change elsewhere must
    // not yank the fields out from under the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, habitId]);

  const areas = useMemo<LifeArea[]>(
    () => [...data.areas].sort((a, b) => a.order - b.order),
    [data.areas],
  );

  const patch = useCallback((next: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const toggleDay = useCallback((day: number): void => {
    setDraft((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((d) => d !== day)
        : normaliseDays([...current.days, day]),
    }));
  }, []);

  const nameValid = draft.name.trim().length > 0;
  const daysValid = draft.cadenceType !== 'weekdays' || draft.days.length > 0;
  const valid = nameValid && daysValid;

  const cadence = useMemo<HabitCadence>(() => {
    if (draft.cadenceType === 'weekdays') {
      return { type: 'weekdays', days: normaliseDays(draft.days) };
    }
    if (draft.cadenceType === 'timesPerWeek') {
      return { type: 'timesPerWeek', target: clampTarget(draft.target) };
    }
    return { type: 'daily' };
  }, [draft.cadenceType, draft.days, draft.target]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const name = draft.name.trim();
    if (name.length === 0) {
      setShowError(true);
      nameRef.current?.focus();
      return;
    }
    if (!daysValid) {
      setShowError(true);
      return;
    }

    if (editing) {
      actions.updateHabit(editing.id, {
        name,
        icon: draft.icon,
        cadence,
        areaId: draft.areaId,
        goalId: draft.goalId,
      });
      toast.success('Habit updated', { description: `${name} · ${cadenceLabel(cadence)}` });
    } else {
      actions.addHabit({
        name,
        icon: draft.icon,
        cadence,
        areaId: draft.areaId,
        goalId: draft.goalId,
      });
      toast.success('Habit created', { description: `${name} · ${cadenceLabel(cadence)}` });
    }

    onOpenChange(false);
  };

  const pillTransition = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 380, damping: 32 } as const);

  const HeaderIcon = iconFor(draft.icon);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={OVERLAY}
        className={clsx('pa-portal', CONTENT, 'sm:max-w-[600px]')}
      >
        <div className="assistant-shell" style={PORTAL_SHELL}>
          <div className={SURFACE}>
            <form onSubmit={submit} className="flex min-h-0 flex-col">
              {/* ---- header ---- */}
              <DialogHeader className="relative shrink-0 gap-0 border-b border-[color:var(--pa-line)] px-5 py-5 sm:px-7">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-8 -top-14 size-44 rounded-full"
                  style={{ background: HEADER_BLOOM }}
                />

                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="pa-chip-solid size-10 shrink-0" aria-hidden="true">
                      <HeaderIcon className="size-[18px]" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="pa-eyebrow leading-none">
                        {editing ? 'Edit habit' : 'New habit'}
                      </p>
                      <DialogTitle className="pa-title mt-1.5 text-[17px] leading-snug">
                        {editing ? editing.name : 'What will you repeat?'}
                      </DialogTitle>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="pa-icon-btn pa-focus -mr-1.5 -mt-1 size-8 shrink-0"
                    aria-label="Close"
                    data-tip="Close"
                    data-tip-key="Esc"
                  >
                    <X className="size-4" strokeWidth={1.9} aria-hidden="true" />
                  </button>
                </div>

                <DialogDescription className="sr-only">
                  Name the habit, choose its icon and cadence, and optionally file it under a life
                  area and the goal it compounds toward.
                </DialogDescription>
              </DialogHeader>

              {/* ---- fields ---- */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
                {/* name */}
                <div>
                  <label htmlFor={`${fieldId}-name`} className={FIELD_LABEL}>
                    Habit
                  </label>
                  <input
                    ref={nameRef}
                    id={`${fieldId}-name`}
                    type="text"
                    value={draft.name}
                    onChange={(event) => {
                      patch({ name: capitaliseOnType(event) });
                      if (showError) setShowError(false);
                    }}
                    placeholder="Read for twenty minutes"
                    autoComplete="off"
                    aria-invalid={showError && !nameValid}
                    aria-describedby={
                      showError && !nameValid ? `${fieldId}-name-error` : undefined
                    }
                    className="pa-input h-11 px-3.5 text-[14px]"
                  />
                  <AnimatePresence initial={false}>
                    {showError && !nameValid ? (
                      <motion.p
                        id={`${fieldId}-name-error`}
                        initial={{ opacity: 0, y: reduce ? 0 : -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: HOUSE_EASE }}
                        className="mt-2 text-[12px] text-[color:var(--pa-red)]"
                      >
                        Give the habit a name — something you could tick without thinking.
                      </motion.p>
                    ) : null}
                  </AnimatePresence>
                </div>

                {/* icon */}
                <div>
                  <span className={FIELD_LABEL}>Icon</span>
                  <div
                    role="group"
                    aria-label="Habit icon"
                    className="grid grid-cols-6 gap-1.5 sm:grid-cols-8"
                  >
                    {ICON_CHOICES.map((name) => {
                      const Choice = iconFor(name);
                      const active = draft.icon === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => patch({ icon: name })}
                          aria-pressed={active}
                          aria-label={name}
                          data-tip={name}
                          className={clsx(
                            'flex size-9 items-center justify-center rounded-[0.85rem]',
                            'transition-colors duration-150',
                            PILL_FOCUS,
                            active ? 'pa-chip-solid' : clsx('border', CHOICE_IDLE),
                          )}
                        >
                          <Choice className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* cadence */}
                <div>
                  <span className={FIELD_LABEL}>Cadence</span>
                  <div role="group" aria-label="Habit cadence" className="pa-seg flex-wrap">
                    {CADENCE_OPTIONS.map((option) => {
                      const active = draft.cadenceType === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            patch({ cadenceType: option.id });
                            if (showError) setShowError(false);
                          }}
                          data-active={active}
                          aria-pressed={active}
                          className="pa-seg-btn pa-focus"
                        >
                          {active ? (
                            <motion.span
                              layoutId="pa-habit-cadence-pill"
                              className="pa-seg-pill"
                              transition={pillTransition}
                            />
                          ) : null}
                          <span className="relative z-[1]">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <AnimatePresence initial={false} mode="wait">
                    {draft.cadenceType === 'weekdays' ? (
                      <motion.div
                        key="weekdays"
                        initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                        transition={{ duration: 0.2, ease: HOUSE_EASE }}
                        className="mt-3"
                      >
                        <div
                          role="group"
                          aria-label="Days of the week"
                          className="grid grid-cols-7 gap-1.5"
                        >
                          {WEEKDAY_LABELS.map((label, index) => {
                            const day = index + 1;
                            const active = draft.days.includes(day);
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() => {
                                  toggleDay(day);
                                  if (showError) setShowError(false);
                                }}
                                aria-pressed={active}
                                aria-label={label}
                                className={clsx(
                                  'inline-flex h-9 items-center justify-center rounded-[0.7rem] border',
                                  'text-[11.5px] font-medium transition-colors duration-150',
                                  PILL_FOCUS,
                                  active ? CHOICE_ACTIVE : CHOICE_IDLE,
                                )}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>

                        <p
                          className={clsx(
                            'mt-2 text-[11.5px] leading-relaxed',
                            daysValid
                              ? 'text-[color:var(--pa-faint)]'
                              : 'text-[color:var(--pa-red)]',
                          )}
                        >
                          {daysValid
                            ? `${cadenceLabel(cadence)} — the days it is not due never break the run.`
                            : 'Pick at least one day, or switch the cadence to daily.'}
                        </p>
                      </motion.div>
                    ) : draft.cadenceType === 'timesPerWeek' ? (
                      <motion.div
                        key="timesPerWeek"
                        initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                        transition={{ duration: 0.2, ease: HOUSE_EASE }}
                        className="mt-3"
                      >
                        <div className="pa-tile flex items-center gap-4 p-3">
                          <button
                            type="button"
                            onClick={() => patch({ target: clampTarget(draft.target - 1) })}
                            disabled={draft.target <= 1}
                            aria-label="One fewer day per week"
                            className="pa-icon-btn pa-focus size-9 shrink-0 disabled:pointer-events-none disabled:opacity-35"
                          >
                            <Minus className="size-4" strokeWidth={2} aria-hidden="true" />
                          </button>

                          <p className="flex-1 text-center">
                            <span
                              className="pa-stat block text-[1.6rem] tabular-nums"
                              aria-live="polite"
                            >
                              {draft.target}
                            </span>
                            <span className="mt-1 block text-[11px] text-[color:var(--pa-faint)]">
                              {plural(draft.target, 'day', 'days')} out of seven
                            </span>
                          </p>

                          <button
                            type="button"
                            onClick={() => patch({ target: clampTarget(draft.target + 1) })}
                            disabled={draft.target >= 7}
                            aria-label="One more day per week"
                            className="pa-icon-btn pa-focus size-9 shrink-0 disabled:pointer-events-none disabled:opacity-35"
                          >
                            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>

                        <p className="mt-2 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                          The streak counts whole weeks, so which days you choose is up to the week
                          you are having.
                        </p>
                      </motion.div>
                    ) : (
                      <motion.p
                        key="daily"
                        initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                        transition={{ duration: 0.2, ease: HOUSE_EASE }}
                        className="mt-3 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]"
                      >
                        Every single day — the simplest cadence to keep, and the hardest to argue
                        with.
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* life area */}
                <div>
                  <span className={FIELD_LABEL}>Life area</span>
                  <div className="flex flex-wrap gap-1.5">
                    <AreaChip
                      label="Unfiled"
                      color={null}
                      active={draft.areaId === null}
                      onSelect={() => patch({ areaId: null })}
                    />
                    {areas.map((area) => (
                      <AreaChip
                        key={area.id}
                        label={area.name}
                        color={area.color}
                        active={draft.areaId === area.id}
                        onSelect={() => patch({ areaId: area.id })}
                      />
                    ))}
                  </div>
                  {areas.length === 0 ? (
                    <p className="mt-2 text-[11.5px] text-[color:var(--pa-faint)]">
                      No life areas yet — the habit will sit unfiled until you make one.
                    </p>
                  ) : null}
                </div>

                {/* goal */}
                <div>
                  <span className={FIELD_LABEL}>Compounds toward</span>
                  <GoalPicker
                    value={draft.goalId}
                    placeholder="A goal this habit serves (optional)"
                    onChange={(goalId) => patch({ goalId })}
                  />
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                    A habit tied to a goal survives the week you stop feeling like it.
                  </p>
                </div>
              </div>

              {/* ---- footer ---- */}
              <div
                className={clsx(
                  'flex shrink-0 items-center justify-end gap-2 px-5 py-4 sm:px-7',
                  'border-t border-[color:var(--pa-line)] bg-[color:var(--pa-well)]',
                )}
              >
                <button type="button" onClick={() => onOpenChange(false)} className={QUIET_PILL}>
                  Cancel
                </button>

                {/* The form's one commitment. An unnamed habit leaves it
                    genuinely `disabled` for the keyboard, and the WRAPPER dims:
                    the glass has no disabled state of its own, and a utility on
                    the button itself would lose the cascade to theme-v2's
                    `.glass-button` (which starts from `all: unset`). */}
                <GlassButton
                  className={clsx(
                    'glass-button--haze-light shrink-0',
                    !valid && 'cursor-default opacity-40',
                  )}
                  size="none"
                  type="submit"
                  disabled={!valid}
                  buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                  contentClassName={GLASS_BOX.h10.content}
                >
                  <span className="inline-flex items-center gap-2">
                    <Check className="size-4" aria-hidden="true" />
                    {editing ? 'Save changes' : 'Create habit'}
                  </span>
                </GlassButton>
              </div>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------
 * Area chip — the one control the form repeats
 * ---------------------------------------------------------------------- */

export interface AreaChipProps {
  label: string;
  color: string | null;
  active: boolean;
  onSelect: () => void;
}

function AreaChip({ label, color, active, onSelect }: AreaChipProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium',
        'transition-colors duration-150',
        PILL_FOCUS,
        active ? CHOICE_ACTIVE : CHOICE_IDLE,
      )}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{
          /* An unfiled chip falls back to the tertiary ink, so the dot stays
           * visible against either stage. */
          background: color ?? 'var(--pa-faint)',
          boxShadow:
            active && color ? `0 0 0 3px color-mix(in srgb, ${color} 14%, transparent)` : undefined,
        }}
      />
      <span className="max-w-[14ch] truncate">{label}</span>
    </button>
  );
}
