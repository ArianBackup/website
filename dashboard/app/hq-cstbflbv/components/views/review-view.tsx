'use client';

/* ---------------------------------------------------------------------------
 * review-view.tsx — the rituals that close a day and a week.
 *
 * Two ceremonies and one record:
 *
 *   1. the altar    — the streak, and the two rituals you can start from here
 *   2. the flow     — the weekly wizard: three steps, one dialog, a step rail
 *   3. the record   — every past review on a timeline, grouped by month
 *
 * The daily shutdown lives in ./daily-shutdown-dialog, because Today wants to
 * start it too; this view owns nothing of it but the `open` boolean and the
 * command-palette event that flips it. The shared wizard chrome (WizardShell,
 * the step parts) is exported from that same module, so the dependency runs one
 * way and Today never has to pull this timeline in behind it.
 *
 * The wizards are deliberately slow: one question per screen, generous space
 * around it, and nothing mandatory. A review you can finish in twenty seconds
 * is a review you will still be doing in November.
 * ------------------------------------------------------------------------- */

import {
  useCallback,
  useEffect,
  useId,
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
  CalendarCheck,
  Check,
  ChevronDown,
  Flag,
  Heart,
  History,
  Lightbulb,
  ListChecks,
  Moon,
  NotebookPen,
  Quote,
  Repeat,
  Sparkles,
  Target,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

import {
  addDaysKey,
  dayNumber,
  daysBetween,
  formatKey,
  relativeDayLabel,
  toKey,
  weekDaysFrom,
  weekStartKey,
  weekdayShort,
} from '../../lib/dates';
import {
  completionSeries,
  isHabitDone,
  isHabitDue,
  overdueTasks,
  reviewStreak,
} from '../../lib/derive';
import { capitaliseOnType } from '../../lib/capitalise';
import { useAssistant } from '../../lib/store';
import type {
  AssistantData,
  DayKey,
  ID,
  ReviewEntry,
  ReviewReflections,
  Task,
  Timestamp,
} from '../../lib/types';

import { EmptyState } from '../shared/empty-state';
import { SectionHeader } from '../shared/section-header';
import { StatTile } from '../shared/stat-tile';
import { StreakChip } from '../shared/streak-chip';
import {
  START_DAILY_REVIEW_EVENT,
  START_WEEKLY_REVIEW_EVENT,
} from '../shared/command-palette';
import {
  DOT_TRACK,
  DailyShutdownDialog,
  GLASS_FOCUS,
  HOUSE_EASE,
  PILL_FOCUS,
  RATING_WORDS,
  RatingPicker,
  ReflectField,
  StepHeading,
  WizardShell,
  plural,
  trimReflections,
} from './daily-shutdown-dialog';

/* -------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------- */

/** How many reviews the timeline shows before asking. */
const PAGE_SIZE = 12;

/** Two-line clamp without depending on a plugin build flag. */
const CLAMP_2: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
};

interface ReflectionMeta {
  key: keyof ReviewReflections;
  label: string;
  icon: LucideIcon;
}

/** Order is fixed: it is the order both flows ask in, and the history reads in. */
const REFLECTION_META: ReflectionMeta[] = [
  { key: 'wins', label: 'What went well', icon: Sparkles },
  { key: 'challenges', label: 'What got in the way', icon: TriangleAlert },
  { key: 'lessons', label: 'What I learned', icon: Lightbulb },
  { key: 'gratitude', label: 'Grateful for', icon: Heart },
];

const WEEKLY_STEPS = ['Numbers', 'Reflect', 'Next week'];

/* -------------------------------------------------------------------------
 * Small pure helpers
 * ---------------------------------------------------------------------- */

/** The LOCAL day an ISO timestamp fell on, or `null` if it is unusable. */
function completedDay(ts: Timestamp | null): DayKey | null {
  if (typeof ts !== 'string' || ts.length === 0) return null;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  return toKey(date);
}

/** `'28 Jul – 3 Aug'` for the week starting at `mondayKey`. */
function weekRangeLabel(mondayKey: DayKey): string {
  return `${formatKey(mondayKey, 'd MMM')} – ${formatKey(addDaysKey(mondayKey, 6), 'd MMM')}`;
}

/** The sentence the focus verdict seeds into the reflection it belongs to. */
function focusLine(focus: string, hit: boolean): string {
  return hit ? `Hit this week's focus — “${focus}”.` : `Missed this week's focus — “${focus}”.`;
}

interface MonthGroup {
  key: string;
  label: string;
  entries: ReviewEntry[];
}

/** Groups an already-sorted list into consecutive runs of the same month. */
function groupByMonth(entries: ReviewEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, label: formatKey(entry.date, 'MMMM yyyy'), entries: [entry] });
  }
  return groups;
}

/** Newest first, with the more recently written entry winning a tie. */
function sortReviews(entries: ReviewEntry[]): ReviewEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return 0;
  });
}

interface WeeklySeed {
  rating: number | null;
  reflections: ReviewReflections;
  nextFocus: string;
  moveIds: Set<ID>;
}

/** Everything the weekly form should say about the week starting `monday`. */
function weeklySeedFromData(data: AssistantData, monday: DayKey): WeeklySeed {
  const nextMonday = addDaysKey(monday, 7);
  const existing = data.reviews.find((r) => r.type === 'weekly' && r.date === monday) ?? null;

  return {
    rating: existing?.rating ?? null,
    reflections: {
      wins: existing?.reflections.wins ?? '',
      challenges: existing?.reflections.challenges ?? '',
      lessons: existing?.reflections.lessons ?? '',
      gratitude: existing?.reflections.gratitude ?? '',
    },
    nextFocus: existing?.nextWeekFocus ?? data.weeks[nextMonday]?.focus ?? '',
    moveIds: new Set(overdueTasks(data, nextMonday).map((task) => task.id)),
  };
}

/* =========================================================================
 * The view
 * ====================================================================== */

export function ReviewView(): JSX.Element {
  const { data, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  /* `today` is the provider's live day: it changes on its own at midnight and
   * every derivation below follows it without a refresh. */
  const monday = weekStartKey(today);

  const [dailyOpen, setDailyOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  /* ---- the command palette and the header can start either ritual ---- */
  useEffect(() => {
    const openDaily = (): void => setDailyOpen(true);
    const openWeekly = (): void => setWeeklyOpen(true);
    window.addEventListener(START_DAILY_REVIEW_EVENT, openDaily);
    window.addEventListener(START_WEEKLY_REVIEW_EVENT, openWeekly);
    return () => {
      window.removeEventListener(START_DAILY_REVIEW_EVENT, openDaily);
      window.removeEventListener(START_WEEKLY_REVIEW_EVENT, openWeekly);
    };
  }, []);

  /* ---- derived ---- */

  const streak = useMemo(() => reviewStreak(data, today), [data, today]);

  const todayReview = useMemo(
    () => data.reviews.find((r) => r.type === 'daily' && r.date === today) ?? null,
    [data.reviews, today],
  );
  const weekReview = useMemo(
    () => data.reviews.find((r) => r.type === 'weekly' && r.date === monday) ?? null,
    [data.reviews, monday],
  );

  const history = useMemo(() => sortReviews(data.reviews), [data.reviews]);
  const groups = useMemo(() => groupByMonth(history.slice(0, visible)), [history, visible]);
  const remaining = Math.max(0, history.length - visible);

  const handleDelete = useCallback(
    (entry: ReviewEntry): void => {
      actions.deleteReview(entry.id);
      toast.success('Review deleted', {
        description: `${entry.type === 'daily' ? 'Daily shutdown' : 'Weekly review'} · ${
          entry.type === 'weekly' ? weekRangeLabel(entry.date) : relativeDayLabel(entry.date, today)
        }`,
      });
    },
    [actions, today],
  );

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
      {/* ================= 1. the altar ================= */}
      <motion.section
        {...rise(0)}
        aria-label="Review rituals"
        className="pa-panel pa-sheen relative overflow-hidden p-5 sm:p-7"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in srgb, var(--pa-violet) 16%, transparent), var(--pa-accent-glow) 58%, transparent 78%)',
          }}
        />

        <div className="relative">
          <SectionHeader
            eyebrow="Reflection"
            title="Review"
            subtitle={
              streak > 0
                ? `${streak} ${plural(streak, 'day', 'days')} of shutdowns in a row. This is the habit that keeps every other number honest.`
                : 'Two minutes at the end of the day is what turns activity into progress.'
            }
            icon={NotebookPen}
            action={<StreakChip count={streak} />}
          />

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <RitualCard
              icon={Moon}
              eyebrow="Every evening"
              title="Daily shutdown"
              noun="shutdown"
              meta={formatKey(today, 'EEEE d MMMM')}
              done={todayReview !== null}
              index={0}
              onOpen={() => setDailyOpen(true)}
            />
            <RitualCard
              icon={CalendarCheck}
              eyebrow="Every Sunday"
              title="Weekly review"
              noun="review"
              meta={weekRangeLabel(monday)}
              done={weekReview !== null}
              index={1}
              onOpen={() => setWeeklyOpen(true)}
            />
          </div>
        </div>
      </motion.section>

      {/* ================= 2. the record ================= */}
      <motion.section {...rise(1)} className="pa-panel p-5 sm:p-6">
        <SectionHeader
          eyebrow="The record"
          title="Past reviews"
          subtitle="Read three of these back and you will spot the pattern you keep living through."
          icon={History}
          action={
            history.length > 0 ? (
              <span className="pa-badge">
                {history.length} {plural(history.length, 'entry', 'entries')}
              </span>
            ) : null
          }
        />

        {history.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No reviews yet"
            description="Two minutes at the end of the day is what turns activity into progress."
            action={
              <GlassButton
                className="glass-button--haze-light"
                size="none"
                type="button"
                buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                contentClassName={GLASS_BOX.h10.content}
                onClick={() => setDailyOpen(true)}
              >
                <span className="inline-flex items-center gap-2">
                  <Moon className="size-4" aria-hidden="true" />
                  Start today&rsquo;s shutdown
                </span>
              </GlassButton>
            }
          />
        ) : (
          <>
            <div className="mt-5 space-y-6">
              {groups.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <div className="sticky top-2 z-[2] mb-3 flex items-center gap-3">
                    <span
                      className="pa-eyebrow rounded-full bg-[color:var(--pa-solid)] px-2.5 py-1 leading-none"
                      style={{ boxShadow: 'var(--pa-shadow-sm)' }}
                    >
                      {group.label}
                    </span>
                    <span className="pa-divider flex-1" aria-hidden />
                  </div>

                  <div className="space-y-3">
                    <AnimatePresence initial={false}>
                      {group.entries.map((entry, index) => (
                        <ReviewHistoryCard
                          key={entry.id}
                          entry={entry}
                          index={index}
                          refDay={today}
                          onDelete={handleDelete}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </section>
              ))}
            </div>

            {remaining > 0 ? (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisible((count) => count + PAGE_SIZE)}
                  className="pa-cta pa-focus h-9 px-4 text-[12.5px]"
                >
                  <ChevronDown className="size-3.5" strokeWidth={1.9} aria-hidden />
                  Show {Math.min(remaining, PAGE_SIZE)} more
                </button>
              </div>
            ) : null}
          </>
        )}
      </motion.section>

      <DailyShutdownDialog open={dailyOpen} onOpenChange={setDailyOpen} />
      <WeeklyReviewDialog open={weeklyOpen} onOpenChange={setWeeklyOpen} />
    </div>
  );
}

/* =========================================================================
 * The two entry cards
 * ====================================================================== */

export interface RitualCardProps {
  icon: LucideIcon;
  /** Uppercase cadence label, e.g. `'Every evening'`. */
  eyebrow: string;
  title: string;
  /** What the action opens, lowercase — `'shutdown'`, `'review'`. */
  noun: string;
  /** The day or week this ritual is about, spelled out. */
  meta: string;
  /** Whether this period already carries a saved review. */
  done: boolean;
  index: number;
  onOpen: () => void;
}

export function RitualCard({
  icon: Icon,
  eyebrow,
  title,
  noun,
  meta,
  done,
  index,
  onOpen,
}: RitualCardProps): JSX.Element {
  const reduce = useReducedMotion();
  const label = `${done ? 'Edit' : 'Start'} ${noun}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : 0.06 + index * 0.05,
      }}
      className={clsx(
        'pa-tile group relative flex flex-col gap-5 overflow-hidden p-4 sm:p-5',
        'transition-colors duration-200 hover:border-[color:var(--pa-accent-ring)]',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'pointer-events-none absolute inset-0 bg-[color:var(--pa-accent-bg)]',
          'opacity-0 transition-opacity duration-300 group-hover:opacity-60',
        )}
      />

      <div className="relative flex items-start gap-3.5">
        <span
          className={clsx('size-11 shrink-0 rounded-[0.95rem]', done ? 'pa-chip' : 'pa-chip-solid')}
          aria-hidden
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="pa-eyebrow leading-none">{eyebrow}</p>
          <p className="mt-2 truncate text-[15px] font-medium leading-snug text-[color:var(--pa-navy)]">
            {title}
          </p>
          <p className="mt-1 truncate text-[12.5px] leading-none text-[color:var(--pa-faint)]">
            {meta}
          </p>
        </div>

        <span className="pa-badge shrink-0" data-tone={done ? 'green' : undefined}>
          {done ? 'Completed' : 'Not done yet'}
        </span>
      </div>

      <div className="relative">
        <GlassButton
          className="glass-button--haze-light"
          size="none"
          type="button"
          buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
          contentClassName={GLASS_BOX.h10.content}
          onClick={onOpen}
          aria-label={`${label} — ${title}, ${meta}`}
        >
          <span className="inline-flex items-center gap-2">
            {label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </span>
        </GlassButton>
      </div>
    </motion.div>
  );
}

/* =========================================================================
 * The weekly review
 * ====================================================================== */

export interface WeeklyReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WeeklyReviewDialog({ open, onOpenChange }: WeeklyReviewDialogProps): JSX.Element {
  const { data, today, actions } = useAssistant();
  const fieldId = useId();

  /* `null` = "whatever week it is right now". An untouched form follows the
   * live clock across a Monday; the first edit pins the draft to the week it
   * was started on, so a review in progress can never be filed under the
   * following week. */
  const [anchorWeek, setAnchorWeek] = useState<DayKey | null>(null);
  const monday = anchorWeek ?? weekStartKey(today);

  const weekDays = useMemo(() => weekDaysFrom(monday), [monday]);
  const sunday = weekDays[6];
  const nextMonday = addDaysKey(monday, 7);

  /* ---- draft ---- */
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [rating, setRating] = useState<number | null>(null);
  const [focusHit, setFocusHit] = useState<boolean | null>(null);
  const [reflections, setReflections] = useState<ReviewReflections>({});
  const [nextFocus, setNextFocus] = useState('');
  const [moveIds, setMoveIds] = useState<Set<ID>>(new Set());

  /* The latest document, so the seeding effect below does not have to re-run on
   * every edit made anywhere else in the app. Declared FIRST so it is already
   * fresh by the time those effects run in the same commit. */
  const dataRef = useRef<AssistantData>(data);
  useEffect(() => {
    dataRef.current = data;
  });

  const existing = useMemo(
    () => data.reviews.find((r) => r.type === 'weekly' && r.date === monday) ?? null,
    [data.reviews, monday],
  );

  const focus = (data.weeks[monday]?.focus ?? '').trim();

  /* ---- the week in numbers ---- */

  const stats = useMemo(() => {
    /* Days that have not happened yet cannot be counted as missed. */
    const statEnd = today < sunday ? today : sunday;
    const elapsed = Math.max(1, daysBetween(monday, statEnd) + 1);

    const series = completionSeries(data, elapsed, statEnd);
    const completed = series.reduce((total, day) => total + day.completed, 0);
    const scheduled = series.reduce((total, day) => total + day.scheduled, 0);

    let habitDue = 0;
    let habitDone = 0;
    for (const habit of data.habits) {
      if (habit.archivedAt) continue;
      for (const day of weekDays) {
        if (day > statEnd) continue;
        if (isHabitDone(data.habitLogs, habit.id, day)) {
          habitDue += 1;
          habitDone += 1;
        } else if (isHabitDue(habit, day, data.habitLogs)) {
          habitDue += 1;
        }
      }
    }

    const inWeek = new Set(weekDays);
    const milestones = data.milestones.filter((milestone) => {
      const day = completedDay(milestone.completedAt);
      return day !== null && inWeek.has(day);
    }).length;

    return {
      completed,
      scheduled,
      rate: scheduled === 0 ? 0 : completed / scheduled,
      habitRate: habitDue === 0 ? 0 : habitDone / habitDue,
      habitDue,
      milestones,
      days: elapsed,
    };
  }, [data, monday, sunday, today, weekDays]);

  /** Everything still open from this week or before. */
  const unfinished = useMemo(() => overdueTasks(data, nextMonday), [data, nextMonday]);

  /* ---- opening, and the week turning underneath ---- */

  useEffect(() => {
    setAnchorWeek(null);
    if (!open) return;
    setStep(0);
    setMaxStep(0);
    setDirection(1);
    setFocusHit(null);
  }, [open]);

  useEffect(() => {
    if (!open || anchorWeek !== null) return;
    const seed = weeklySeedFromData(dataRef.current, weekStartKey(today));
    setRating(seed.rating);
    setReflections(seed.reflections);
    setNextFocus(seed.nextFocus);
    setMoveIds(seed.moveIds);
  }, [open, today, anchorWeek]);

  /** The first edit pins the draft to the week it was started on. */
  const touch = useCallback((): void => {
    setAnchorWeek((current) => current ?? monday);
  }, [monday]);

  /* ---- edits ---- */

  const handleRating = useCallback(
    (value: number | null): void => {
      touch();
      setRating(value);
    },
    [touch],
  );

  const handleVerdict = useCallback(
    (verdict: boolean): void => {
      touch();
      setFocusHit((value) => (value === verdict ? null : verdict));
    },
    [touch],
  );

  const handleReflection = useCallback(
    (key: keyof ReviewReflections, value: string): void => {
      touch();
      setReflections((draft) => ({ ...draft, [key]: value }));
    },
    [touch],
  );

  const handleNextFocus = useCallback(
    (value: string): void => {
      touch();
      setNextFocus(value);
    },
    [touch],
  );

  const toggleMove = useCallback(
    (id: ID): void => {
      touch();
      setMoveIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [touch],
  );

  const setAllMoves = useCallback(
    (ids: ID[]): void => {
      touch();
      setMoveIds(new Set(ids));
    },
    [touch],
  );

  /* ---- navigation ---- */

  const goTo = useCallback(
    (next: number): void => {
      const clamped = Math.max(0, Math.min(next, WEEKLY_STEPS.length - 1));
      setDirection(clamped >= step ? 1 : -1);
      setStep(clamped);
      setMaxStep((furthest) => Math.max(furthest, clamped));
    },
    [step],
  );

  /* Leaving the numbers behind, the focus verdict writes itself into the
   * reflection it belongs to — visibly, and only into a box you left empty. */
  const handleNext = useCallback((): void => {
    if (step === 0 && focus.length > 0 && focusHit !== null) {
      const key: keyof ReviewReflections = focusHit ? 'wins' : 'challenges';
      setReflections((draft) => {
        if ((draft[key] ?? '').trim().length > 0) return draft;
        return { ...draft, [key]: focusLine(focus, focusHit) };
      });
    }
    goTo(step + 1);
  }, [focus, focusHit, goTo, step]);

  /* ---- save ---- */

  const submit = useCallback((): void => {
    const trimmedFocus = nextFocus.trim();

    actions.saveReview({
      type: 'weekly',
      date: monday,
      rating,
      reflections: trimReflections(reflections, ['wins', 'challenges', 'lessons', 'gratitude']),
      nextWeekFocus: trimmedFocus.length > 0 ? trimmedFocus : undefined,
    });

    let moved = 0;
    for (const task of unfinished) {
      if (!moveIds.has(task.id)) continue;
      actions.scheduleTask(task.id, nextMonday);
      moved += 1;
    }

    const parts: string[] = [];
    if (trimmedFocus.length > 0) parts.push('Next week has a focus');
    if (moved > 0) parts.push(`${moved} ${plural(moved, 'task', 'tasks')} moved to Monday`);

    toast.success(existing ? 'Weekly review updated' : 'Week closed', {
      description: parts.length > 0 ? `${parts.join(' · ')}.` : 'The week is on the record.',
    });

    onOpenChange(false);
  }, [
    actions,
    existing,
    moveIds,
    monday,
    nextFocus,
    nextMonday,
    onOpenChange,
    rating,
    reflections,
    unfinished,
  ]);

  /* ---- the three steps ---- */

  let body: ReactNode = null;

  if (step === 0) {
    body = (
      <div>
        <StepHeading
          title="The week in numbers"
          hint={`${weekRangeLabel(monday)} — ${stats.days} ${plural(stats.days, 'day', 'days')} in. Look before you judge.`}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Tasks completed"
            value={stats.completed}
            hint={`of ${stats.scheduled} scheduled this week`}
            icon={ListChecks}
          />
          <StatTile
            label="Completion"
            value={Math.round(stats.rate * 100)}
            suffix="%"
            hint={stats.scheduled === 0 ? 'Nothing was scheduled' : 'Of everything you planned'}
            icon={Target}
            tone={stats.rate >= 0.7 ? 'green' : stats.rate >= 0.4 ? 'default' : 'amber'}
          />
          <StatTile
            label="Habit consistency"
            value={Math.round(stats.habitRate * 100)}
            suffix="%"
            hint={stats.habitDue === 0 ? 'No habits were due' : `${stats.habitDue} due this week`}
            icon={Repeat}
            tone={stats.habitRate >= 0.7 ? 'green' : stats.habitRate >= 0.4 ? 'default' : 'amber'}
          />
          <StatTile
            label="Milestones hit"
            value={stats.milestones}
            hint={stats.milestones === 0 ? 'None closed out this week' : 'Real progress up the cascade'}
            icon={Flag}
          />
        </div>

        {/* ---- the focus, and whether you hit it ---- */}
        <div className="mt-4">
          {focus.length > 0 ? (
            <div
              className="pa-tile relative overflow-hidden p-4"
              style={{
                background: 'var(--pa-accent-bg)',
                borderColor: 'var(--pa-accent-ring)',
              }}
            >
              <Quote
                className="pointer-events-none absolute -right-3 -top-2 size-16 text-[color:var(--pa-accent-bg-strong)]"
                strokeWidth={1.1}
                aria-hidden
              />
              <p className="pa-eyebrow relative leading-none">This week&rsquo;s focus</p>
              <p className="relative mt-2 max-w-[52ch] text-[14px] italic leading-relaxed text-[color:var(--pa-navy)]">
                “{focus}”
              </p>

              <div className="relative mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-[color:var(--pa-muted)]">Did you hit it?</span>
                <VerdictButton
                  label="Yes"
                  tone="green"
                  active={focusHit === true}
                  onClick={() => handleVerdict(true)}
                />
                <VerdictButton
                  label="Not quite"
                  tone="amber"
                  active={focusHit === false}
                  onClick={() => handleVerdict(false)}
                />
              </div>

              <AnimatePresence initial={false}>
                {focusHit !== null ? (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: HOUSE_EASE }}
                    className="relative overflow-hidden text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]"
                  >
                    <span className="block pt-2.5">
                      That answer starts your {focusHit ? 'wins' : 'challenges'} on the next screen —
                      edit or delete it there.
                    </span>
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          ) : (
            <div className="pa-drop flex items-center gap-3 p-4">
              <span className="pa-chip size-8 shrink-0 rounded-[0.7rem]" aria-hidden>
                <Flag className="size-4" strokeWidth={1.9} />
              </span>
              <p className="text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
                No focus was set for this week — there is nothing to hold the numbers against. Write
                one for next week on the last step.
              </p>
            </div>
          )}
        </div>

        <hr className="pa-divider my-5" />

        <p className="mb-3 text-[12.5px] text-[color:var(--pa-muted)]">
          How did the week feel, whatever the numbers say?
        </p>
        <RatingPicker
          value={rating}
          onChange={handleRating}
          label="How did the week feel?"
          pickerId="pa-weekly"
          compact
        />
      </div>
    );
  } else if (step === 1) {
    body = (
      <div>
        <StepHeading
          title="Reflect"
          hint="Four questions. Write for the version of you that reads this back in three months."
        />

        <div className="space-y-5">
          <ReflectField
            id={`${fieldId}-wins`}
            index={0}
            icon={Sparkles}
            label="Wins"
            prompt="What actually moved this week — however small it looked at the time."
            value={reflections.wins ?? ''}
            onChange={(value) => handleReflection('wins', value)}
          />
          <ReflectField
            id={`${fieldId}-challenges`}
            index={1}
            icon={TriangleAlert}
            label="Challenges"
            prompt="What kept stalling, and what was underneath it."
            value={reflections.challenges ?? ''}
            onChange={(value) => handleReflection('challenges', value)}
          />
          <ReflectField
            id={`${fieldId}-lessons`}
            index={2}
            icon={Lightbulb}
            label="Lessons"
            prompt="One thing you would do differently if you ran the week again."
            value={reflections.lessons ?? ''}
            onChange={(value) => handleReflection('lessons', value)}
          />
          <ReflectField
            id={`${fieldId}-gratitude`}
            index={3}
            icon={Heart}
            label="Gratitude"
            prompt="Who or what made this week better than it would have been."
            value={reflections.gratitude ?? ''}
            onChange={(value) => handleReflection('gratitude', value)}
          />
        </div>
      </div>
    );
  } else {
    const selected = unfinished.filter((task) => moveIds.has(task.id)).length;
    const allSelected = unfinished.length > 0 && selected === unfinished.length;

    body = (
      <div>
        <StepHeading
          title="Next week"
          hint="One sentence that makes the next seven days obvious, and a decision on everything left open."
        />

        <div>
          <label
            htmlFor={`${fieldId}-focus`}
            className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.11em] text-[color:var(--pa-faint)]"
          >
            <Flag className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
            Focus for {formatKey(nextMonday, 'd MMM')} – {formatKey(addDaysKey(nextMonday, 6), 'd MMM')}
          </label>
          <input
            id={`${fieldId}-focus`}
            type="text"
            value={nextFocus}
            onChange={(event) => handleNextFocus(capitaliseOnType(event))}
            placeholder="Ship the beta, and protect the mornings."
            autoComplete="off"
            className="pa-input h-11 px-3.5 text-[14px]"
          />
          <p className="mt-2 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
            This shows up on Today and on the Week board all week.
          </p>
        </div>

        <hr className="pa-divider my-5" />

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] leading-snug text-[color:var(--pa-navy)]">
              Still open{unfinished.length > 0 ? ` — ${unfinished.length}` : ''}
            </p>
            <p className="mt-1 text-[11.5px] leading-none text-[color:var(--pa-faint)]">
              {unfinished.length === 0
                ? 'Nothing was left behind this week.'
                : `${selected} will move to Monday.`}
            </p>
          </div>

          {unfinished.length > 0 ? (
            <button
              type="button"
              onClick={() => setAllMoves(allSelected ? [] : unfinished.map((task) => task.id))}
              className="pa-btn pa-focus h-8 px-2.5 text-[12px]"
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          ) : null}
        </div>

        {unfinished.length === 0 ? (
          <div className="pa-well flex items-center gap-3 p-4">
            <span className="pa-chip size-8 shrink-0 rounded-[0.7rem]" aria-hidden>
              <Check className="size-4" strokeWidth={2.25} />
            </span>
            <p className="text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
              Every task you scheduled this week is finished. Start Monday with a clean board.
            </p>
          </div>
        ) : (
          <div className="pa-well max-h-[236px] space-y-1.5 overflow-y-auto p-2.5">
            {unfinished.map((task, index) => (
              <CarryRow
                key={task.id}
                task={task}
                index={index}
                refDay={today}
                selected={moveIds.has(task.id)}
                onToggle={toggleMove}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <WizardShell
      open={open}
      onOpenChange={onOpenChange}
      icon={CalendarCheck}
      eyebrow={existing ? 'Editing this week’s review' : 'Weekly review'}
      title={weekRangeLabel(monday)}
      description="Read the week's numbers, judge the focus you set, write four reflections, then name next week's focus and roll unfinished work forward."
      steps={WEEKLY_STEPS}
      step={step}
      maxStep={maxStep}
      direction={direction}
      railId="pa-weekly"
      onStep={goTo}
      onBack={() => goTo(step - 1)}
      onNext={handleNext}
      onSubmit={submit}
      submitLabel="Complete review"
      widthClassName="sm:max-w-[700px]"
    >
      {body}
    </WizardShell>
  );
}

/* -------------------------------------------------------------------------
 * Weekly parts
 * ---------------------------------------------------------------------- */

export interface VerdictButtonProps {
  label: string;
  tone: 'green' | 'amber';
  active: boolean;
  onClick: () => void;
}

export function VerdictButton({ label, tone, active, onClick }: VerdictButtonProps): JSX.Element {
  const activeStyle: CSSProperties =
    tone === 'green'
      ? {
          background: 'var(--pa-green-bg)',
          borderColor: 'color-mix(in srgb, var(--pa-green) 45%, transparent)',
          color: 'var(--pa-green)',
        }
      : {
          background: 'var(--pa-amber-bg)',
          borderColor: 'color-mix(in srgb, var(--pa-amber) 45%, transparent)',
          color: 'var(--pa-amber)',
        };

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={active ? activeStyle : undefined}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium',
        'transition-colors duration-150',
        PILL_FOCUS,
        active
          ? ''
          : clsx(
              'border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)]',
              'text-[color:var(--pa-muted)]',
              'hover:border-[color:var(--pa-accent-border)] hover:text-[color:var(--pa-navy)]',
            ),
      )}
    >
      {active ? <Check className="size-3.5 shrink-0" strokeWidth={2.4} aria-hidden /> : null}
      {label}
    </button>
  );
}

export interface CarryRowProps {
  task: Task;
  index: number;
  refDay: DayKey;
  selected: boolean;
  onToggle: (id: ID) => void;
}

export function CarryRow({ task, index, refDay, selected, onToggle }: CarryRowProps): JSX.Element {
  const reduce = useReducedMotion();

  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Move "${task.title}" to next Monday`}
      onClick={() => onToggle(task.id)}
      initial={{ opacity: 0, y: reduce ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      className="pa-row pa-row-hover pa-focus flex w-full items-center gap-3 px-2.5 py-2 text-left"
    >
      <span className="pa-check" data-checked={selected ? 'true' : 'false'} aria-hidden>
        <AnimatePresence initial={false}>
          {selected ? (
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

      <span className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--pa-navy)]">
        {task.title}
      </span>

      {task.scheduledFor !== null ? (
        <span className="pa-badge shrink-0">{relativeDayLabel(task.scheduledFor, refDay)}</span>
      ) : null}
    </motion.button>
  );
}

/* =========================================================================
 * The record
 * ====================================================================== */

export interface ReviewHistoryCardProps {
  entry: ReviewEntry;
  index: number;
  refDay: DayKey;
  onDelete: (entry: ReviewEntry) => void;
}

export function ReviewHistoryCard({
  entry,
  index,
  refDay,
  onDelete,
}: ReviewHistoryCardProps): JSX.Element {
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [arming, setArming] = useState(false);

  /* A delete that is armed and then ignored disarms itself. */
  useEffect(() => {
    if (!arming) return undefined;
    const timer = window.setTimeout(() => setArming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [arming]);

  const weekly = entry.type === 'weekly';

  const fields = REFLECTION_META.map((meta) => ({
    ...meta,
    text: (entry.reflections[meta.key] ?? '').trim(),
  })).filter((field) => field.text.length > 0);

  const big3 = (entry.tomorrowBig3 ?? []).filter((title) => title.trim().length > 0);
  const nextFocus = (entry.nextWeekFocus ?? '').trim();
  const hasExtras = big3.length > 0 || nextFocus.length > 0;

  /* No measuring, no layout thrash: a card offers "read more" whenever something
   * could actually be hidden — an answer long enough to pass two lines on a
   * phone, or the priorities and focus the review set up. */
  const expandable = hasExtras || fields.some((field) => field.text.length > 80);

  const rating = typeof entry.rating === 'number' ? entry.rating : null;

  return (
    <motion.article
      layout={reduce ? false : 'position'}
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.18 } }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      className="pa-card group p-4 sm:p-5"
    >
      <div className="flex gap-4 sm:gap-5">
        {/* ---- gutter ---- */}
        <div className="flex w-[54px] shrink-0 flex-col items-center gap-1.5 sm:w-[64px]">
          <span className="pa-display text-[26px] tabular-nums sm:text-[30px]">
            {dayNumber(entry.date)}
          </span>
          <span className="text-[10px] uppercase leading-none tracking-[0.13em] text-[color:var(--pa-faint)]">
            {weekdayShort(entry.date)}
          </span>
          <span className="pa-badge mt-1" data-tone={weekly ? 'azure' : undefined}>
            {weekly ? 'Weekly' : 'Daily'}
          </span>
        </div>

        {/* ---- content ---- */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-medium leading-snug text-[color:var(--pa-navy)]">
                {weekly ? 'Weekly review' : 'Daily shutdown'}
              </h3>
              <p className="mt-1 truncate text-[12px] leading-none text-[color:var(--pa-faint)]">
                {weekly ? weekRangeLabel(entry.date) : relativeDayLabel(entry.date, refDay)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {rating !== null ? (
                <span
                  className="flex items-center gap-1"
                  role="img"
                  aria-label={`Rated ${rating} out of 5`}
                  data-tip={`${rating}/5 — ${RATING_WORDS[rating - 1] ?? ''}`}
                >
                  {[1, 2, 3, 4, 5].map((score) => (
                    <span
                      key={score}
                      aria-hidden
                      className="size-1.5 rounded-full"
                      style={{ background: score <= rating ? 'var(--pa-grad)' : DOT_TRACK }}
                    />
                  ))}
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  if (!arming) {
                    setArming(true);
                    return;
                  }
                  onDelete(entry);
                }}
                data-danger="true"
                aria-label={
                  arming
                    ? `Confirm deleting the ${weekly ? 'weekly review' : 'daily shutdown'} for ${entry.date}`
                    : `Delete the ${weekly ? 'weekly review' : 'daily shutdown'} for ${entry.date}`
                }
                data-tip={arming ? 'Click again to delete' : 'Delete review'}
                className={clsx(
                  'pa-icon-btn pa-focus size-7 shrink-0 transition-opacity duration-200',
                  arming
                    ? 'opacity-100'
                    : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100',
                )}
                style={
                  arming
                    ? { background: 'var(--pa-red-bg)', color: 'var(--pa-red)' }
                    : undefined
                }
              >
                <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
              </button>
            </div>
          </div>

          {/* ---- reflections ---- */}
          {fields.length === 0 && !hasExtras ? (
            <p className="mt-3 text-[12.5px] leading-relaxed text-[color:var(--pa-faint)]">
              No notes on this one — just the rating.
            </p>
          ) : (
            <div className="mt-3.5 space-y-3">
              {fields.map((field) => {
                const Icon = field.icon;
                return (
                  <div key={field.key}>
                    <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase leading-none tracking-[0.11em] text-[color:var(--pa-faint)]">
                      <Icon className="size-3 shrink-0" strokeWidth={2} aria-hidden />
                      {field.label}
                    </p>
                    <p
                      className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-[color:var(--pa-muted)]"
                      style={expanded ? undefined : CLAMP_2}
                    >
                      {field.text}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- what it set up ---- */}
          <AnimatePresence initial={false}>
            {expanded && hasExtras ? (
              <motion.div
                key="extras"
                initial={{ opacity: 0, height: reduce ? 'auto' : 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: reduce ? 'auto' : 0 }}
                transition={{ duration: 0.25, ease: HOUSE_EASE }}
                className="overflow-hidden"
              >
                <div className="pa-well mt-4 p-3.5">
                  {nextFocus.length > 0 ? (
                    <>
                      <p className="pa-eyebrow leading-none">Focus set for the week after</p>
                      <p className="mt-2 text-[13px] italic leading-relaxed text-[color:var(--pa-navy)]">
                        “{nextFocus}”
                      </p>
                    </>
                  ) : null}

                  {big3.length > 0 ? (
                    <>
                      <p
                        className={clsx('pa-eyebrow leading-none', nextFocus.length > 0 && 'mt-4')}
                      >
                        Priorities set for the next day
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {big3.map((title, position) => (
                          <li
                            key={`${entry.id}-big3-${position}`}
                            className="flex items-center gap-2.5 text-[13px] text-[color:var(--pa-muted)]"
                          >
                            <span
                              className="pa-avatar size-5 shrink-0 text-[10.5px] tabular-nums"
                              aria-hidden
                            >
                              {position + 1}
                            </span>
                            <span className="min-w-0 truncate">{title}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {expandable ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className={clsx(
                'mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 py-1.5 sm:min-h-0',
                'text-[12px] font-medium text-[color:var(--pa-faint)]',
                'transition-colors duration-150 hover:text-[color:var(--pa-navy)]',
                PILL_FOCUS,
              )}
            >
              <motion.span
                className="inline-flex"
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.2, ease: HOUSE_EASE }}
                aria-hidden
              >
                <ChevronDown className="size-3.5" strokeWidth={2} />
              </motion.span>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          ) : null}
        </div>
      </div>
    </motion.article>
  );
}
