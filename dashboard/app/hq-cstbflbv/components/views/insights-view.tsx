'use client';

/* ---------------------------------------------------------------------------
 * insights-view.tsx — THE EVIDENCE.
 *
 * Every other surface is about intention. This one is the only place the system
 * answers back, so it is built to be honest rather than flattering:
 *
 *   1. the range      one control, driving every number below it
 *   2. the KPIs       four numbers that survive being read in two seconds
 *   3. momentum       completion per day, with your own average drawn across it
 *   4. the split      where the finished work went, and which habits held
 *   5. the ladder     every active goal ranked by how far it has actually moved
 *   6. the reviews    eight weeks of shutdowns, because the habit of looking
 *                     back is the one that keeps the rest of this true
 *
 * Two rules run through the charts. A day with nothing scheduled is drawn as a
 * GAP, never as a zero — you cannot fail a plan you never made. And colour never
 * carries meaning alone: every area is named on its axis, every habit is named
 * in the legend, every bar is labelled with its own number.
 *
 * Read-only by construction: this file calls no actions and mutates nothing.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import {
  Activity,
  CalendarCheck,
  ChevronRight,
  Flame,
  Gauge,
  Layers,
  LineChart as LineChartIcon,
  ListChecks,
  NotebookPen,
  Repeat,
  Target,
  TrendingUp,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type RefObject, useSyncExternalStore } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { addDaysKey, formatKey, toKey, weekDaysFrom, weekStartKey } from '../../lib/dates';
import {
  activeGoals,
  completionSeries,
  goalProgress,
  habitConsistency,
  momentumScore,
  reviewStreak,
  tasksByArea,
} from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import { useAssistantTheme, type PaTheme } from '../../lib/theme';
import type { AssistantData, DayKey, Goal, GoalProgress, ID, LifeArea } from '../../lib/types';

import { OPEN_GOAL_EVENT } from '../shared/command-palette';
import { EmptyState } from '../shared/empty-state';
import { Meter } from '../shared/meter';
import { SectionHeader } from '../shared/section-header';
import { StatTile } from '../shared/stat-tile';
import { StreakChip } from '../shared/streak-chip';

/* -------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------- */

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** The shell mirrors its active view into `location.hash`; it also listens here. */
const NAVIGATE_EVENT = 'assistant:navigate';

/** Long enough for the workspace's view cross-fade to have mounted the target. */
const VIEW_SWITCH_MS = 380;

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

/** Below this many days with any activity at all, a chart is just noise. */
const MIN_HISTORY_DAYS = 3;

/** Weeks drawn in the review strip. Eight is a habit; two is a mood. */
const REVIEW_WEEKS = 8;

/** More bars than this and the habit chart's labels stop being readable. */
const MAX_HABIT_BARS = 8;

/* A translucent tile would be unreadable floating over a chart, so the tooltip
 * takes the tile's geometry and the near-opaque dialog fill. Both vars resolve
 * because recharts renders the tooltip inside the shell, not in a portal. */
const TOOLTIP_SURFACE = {
  background: 'var(--pa-solid)',
  boxShadow: 'var(--pa-shadow-xl)',
} as const;

const MICRO_LABEL =
  'text-[10px] font-medium uppercase leading-none tracking-[0.11em] text-[color:var(--pa-faint)]';

/** Keeps a pill's shape while focused, which `.pa-focus` would square off. */
const PILL_FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--pa-accent-ring)]';

/** Mon…Sun down the review strip, captioned sparsely so the gutter stays quiet. */
const REVIEW_ROW_LABELS = ['M', '', 'W', '', 'F', '', ''];

/* -------------------------------------------------------------------------
 * Chart palette
 *
 * Every other surface in the portal inherits the theme for free, because every
 * colour it uses is a `var(--pa-…)` in a CSS declaration. Charts cannot: recharts
 * writes colour into SVG ATTRIBUTES (`fill`, `stroke`, `stop-color`), and a
 * custom property is not substituted there — a `var()` in an attribute is simply
 * dropped, which on a dark stage means invisible grid lines and no axis labels.
 *
 * So the tokens are read BACK off the live shell as literal strings and handed
 * to the charts as props, and re-read whenever the theme flips. The stylesheet
 * stays the single source of truth; this is only a bridge across the SVG border.
 * ---------------------------------------------------------------------- */

export interface ChartPalette {
  /** Series ink. */
  azure: string;
  /** The second series colour — it marks the most consistent habit. */
  violet: string;
  /** Horizontal grid rules. */
  grid: string;
  /** Axis tick labels. */
  tick: string;
  /** The dashed average line, and the swatch that names it. */
  reference: string;
  /** Numerals set beside a bar. */
  label: string;
  /** Opaque fill for the dots that punch out of the line. */
  paper: string;
}

/** Which token each slot is read from. */
const PALETTE_TOKENS: Record<keyof ChartPalette, string> = {
  azure: '--pa-azure',
  violet: '--pa-violet',
  grid: '--pa-line',
  tick: '--pa-muted',
  reference: '--pa-faint',
  label: '--pa-muted',
  paper: '--pa-solid',
};

/** Dark mode's chart ink — see FALLBACK_PALETTE below. */
const DARK_CHART_PALETTE: ChartPalette = {
  azure: '#35abff',
  violet: '#a78bfa',
  grid: 'rgba(255, 255, 255, 0.1)',
  tick: 'rgba(233, 238, 252, 0.64)',
  reference: 'rgba(233, 238, 252, 0.42)',
  label: 'rgba(233, 238, 252, 0.64)',
  paper: 'rgba(18, 27, 50, 0.97)',
};

/**
 * What the charts paint with for the single frame before the tokens have been
 * read, and if one ever resolves empty. Mirrors assistant.css — if you change a
 * token there, change it here.
 */
const FALLBACK_PALETTE: Record<PaTheme, ChartPalette> = {
  light: {
    azure: '#0099ff',
    violet: '#7c5cd6',
    grid: 'rgba(15, 57, 139, 0.1)',
    tick: 'rgba(15, 57, 139, 0.62)',
    reference: 'rgba(15, 57, 139, 0.44)',
    label: 'rgba(15, 57, 139, 0.62)',
    paper: 'rgba(255, 255, 255, 0.96)',
  },
  dark: DARK_CHART_PALETTE,
};

const PALETTE_KEYS = Object.keys(PALETTE_TOKENS) as (keyof ChartPalette)[];

function samePalette(a: ChartPalette, b: ChartPalette): boolean {
  return PALETTE_KEYS.every((key) => a[key] === b[key]);
}

function readPalette(element: HTMLElement | null, theme: PaTheme): ChartPalette {
  const fallback = FALLBACK_PALETTE[theme];
  if (element === null || typeof window === 'undefined') return fallback;

  const computed = window.getComputedStyle(element);
  const resolved = {} as ChartPalette;

  for (const key of PALETTE_KEYS) {
    const value = computed.getPropertyValue(PALETTE_TOKENS[key]).trim();
    resolved[key] = value.length > 0 ? value : fallback[key];
  }
  return resolved;
}

/**
 * The resolved chart colours for the theme in force.
 *
 * `ref` must point at an element inside `.assistant-shell` — that is where the
 * tokens are declared, so `getComputedStyle` on anything above it resolves to
 * nothing. Custom properties are not transitioned, so the read lands on the new
 * values immediately rather than mid-fade.
 */
function useChartPalette(ref: RefObject<HTMLElement>): ChartPalette {
  const { theme } = useAssistantTheme();
  const [palette, setPalette] = useState<ChartPalette>(() => FALLBACK_PALETTE[theme]);

  useEffect(() => {
    const next = readPalette(ref.current, theme);
    // The theme store only reports `ready` after mount, so this runs twice on
    // the way in with the same answer both times — keeping the old object skips
    // a re-render of every chart for nothing.
    setPalette((current) => (samePalette(current, next) ? current : next));
  }, [ref, theme]);

  return palette;
}

/* -------------------------------------------------------------------------
 * Small pure helpers
 * ---------------------------------------------------------------------- */

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function percent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** The LOCAL day an ISO timestamp fell on, or `null` if it is unusable. */
function timestampDay(ts: string | null): DayKey | null {
  if (typeof ts !== 'string' || ts.length === 0) return null;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  return toKey(date);
}

/** Distinct days the system was actually used — the honest measure of history. */
function historyDayCount(data: AssistantData): number {
  const days = new Set<DayKey>();
  for (const task of data.tasks) {
    if (task.scheduledFor !== null) days.add(task.scheduledFor);
    const done = timestampDay(task.completedAt);
    if (done !== null) days.add(done);
  }
  for (const log of data.habitLogs) days.add(log.date);
  for (const review of data.reviews) days.add(review.date);
  return days.size;
}

/** How a goal's number was arrived at, said plainly. */
function basisLabel(progress: GoalProgress): string {
  if (progress.basis === 'milestones') {
    return `${progress.done} of ${progress.total} ${plural(progress.total, 'milestone', 'milestones')}`;
  }
  if (progress.basis === 'tasks') {
    return `${progress.done} of ${progress.total} ${plural(progress.total, 'task', 'tasks')}`;
  }
  if (progress.basis === 'goals') {
    return `Across ${progress.total} ${plural(progress.total, 'goal', 'goals')} beneath it`;
  }
  return 'Nothing broken down yet';
}

const HORIZON_LABEL: Record<Goal['horizon'], string> = {
  vision: 'Vision',
  year: 'Year',
  quarter: 'Quarter',
};

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
 * View models
 * ---------------------------------------------------------------------- */

export interface MomentumPoint {
  date: DayKey;
  label: string;
  completed: number;
  scheduled: number;
  /** `null` on a day with nothing scheduled — an unplanned day is not a 0 % day. */
  value: number | null;
}

export interface AreaBar {
  key: string;
  name: string;
  color: string;
  completed: number;
}

export interface HabitBar {
  habitId: ID;
  name: string;
  short: string;
  value: number;
  current: number;
  best: number;
}

export interface GoalRowModel {
  goal: Goal;
  progress: GoalProgress;
  area: LifeArea | null;
}

export interface ReviewWeek {
  monday: DayKey;
  label: string;
  days: { day: DayKey; reviewed: boolean; future: boolean }[];
  count: number;
  weekly: boolean;
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function InsightsView(): JSX.Element {
  /* `today` comes from the provider, which owns a LIVE day: it flips on its own
   * at midnight and re-renders this tree, so every window below re-slices onto
   * the new day without a reload. */
  const { data, today } = useAssistant();
  const reduce = useReducedMotion();

  const [days, setDays] = useState<RangeDays>(30);

  /* The charts read their colours off this node — it is the first element
   * inside `.assistant-shell` that this view owns. */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const palette = useChartPalette(rootRef);

  /* ---- derived: the series ---- */

  const series = useMemo<MomentumPoint[]>(
    () =>
      completionSeries(data, days, today).map((row) => ({
        date: row.date,
        label: row.label,
        completed: row.completed,
        scheduled: row.scheduled,
        value: row.scheduled === 0 ? null : percent(row.ratio),
      })),
    [data, days, today],
  );

  const plannedDays = useMemo<number>(
    () => series.reduce((count, point) => (point.value === null ? count : count + 1), 0),
    [series],
  );

  const scheduledTotal = useMemo<number>(
    () => series.reduce((sum, point) => sum + point.scheduled, 0),
    [series],
  );

  const completedOnPlan = useMemo<number>(
    () => series.reduce((sum, point) => sum + point.completed, 0),
    [series],
  );

  const completionRate =
    scheduledTotal === 0 ? 0 : percent(completedOnPlan / scheduledTotal);

  /** One tick per ~7 columns, so ninety days never collides into a smear. */
  /* One media read the three charts share. `useSyncExternalStore` rather than
   * an effect so the first client render already has the right answer; the SSR
   * snapshot is `false`, which is the desktop shape and therefore the safe
   * one to hydrate against. */
  const narrow = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia('(max-width: 639px)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(max-width: 639px)').matches,
    () => false,
  );

  /* ---- derived: the rollups ---- */

  const areaRows = useMemo<AreaBar[]>(
    () =>
      tasksByArea(data, days, today)
        .filter((row) => row.completed > 0)
        .map((row) => ({
          key: row.areaId ?? 'unassigned',
          name: row.name,
          color: row.color,
          completed: row.completed,
        })),
    [data, days, today],
  );

  const completedInRange = useMemo<number>(
    () => areaRows.reduce((sum, row) => sum + row.completed, 0),
    [areaRows],
  );

  const habitRows = useMemo(() => habitConsistency(data, days, today), [data, days, today]);

  const habitBars = useMemo<HabitBar[]>(
    () =>
      habitRows.slice(0, MAX_HABIT_BARS).map((row) => ({
        habitId: row.habitId,
        name: row.name,
        short: truncate(row.name, 8),
        value: percent(row.ratio),
        current: row.current,
        best: row.best,
      })),
    [habitRows],
  );

  /** Only crown a leader when there is a field to lead and something to show. */
  const leadHabitId = useMemo<ID | null>(() => {
    if (habitBars.length < 2) return null;
    const leader = habitBars[0];
    return leader.value > 0 ? leader.habitId : null;
  }, [habitBars]);

  const streakLeader = useMemo(() => {
    let leader: HabitBar | null = null;
    for (const row of habitBars) {
      if (leader === null || row.current > leader.current) leader = row;
    }
    return leader;
  }, [habitBars]);

  const momentum = useMemo<number>(() => momentumScore(data, today), [data, today]);

  const goalRows = useMemo<GoalRowModel[]>(
    () =>
      activeGoals(data)
        .map((goal) => ({
          goal,
          progress: goalProgress(data, goal.id),
          area:
            goal.areaId === null ? null : (data.areas.find((a) => a.id === goal.areaId) ?? null),
        }))
        .sort((a, b) => {
          if (b.progress.ratio !== a.progress.ratio) return b.progress.ratio - a.progress.ratio;
          return a.goal.order - b.goal.order;
        }),
    [data],
  );

  /* ---- derived: the review strip ---- */

  const reviewWeeks = useMemo<ReviewWeek[]>(() => {
    const dailyDays = new Set(
      data.reviews.filter((r) => r.type === 'daily').map((r) => r.date),
    );
    const weeklyMondays = new Set(
      data.reviews.filter((r) => r.type === 'weekly').map((r) => r.date),
    );
    const thisMonday = weekStartKey(today);

    const weeks: ReviewWeek[] = [];
    for (let back = REVIEW_WEEKS - 1; back >= 0; back -= 1) {
      const monday = addDaysKey(thisMonday, -7 * back);
      const cells = weekDaysFrom(monday).map((day) => ({
        day,
        reviewed: dailyDays.has(day),
        future: day > today,
      }));
      weeks.push({
        monday,
        label: formatKey(monday, 'd MMM'),
        days: cells,
        count: cells.filter((cell) => cell.reviewed).length,
        weekly: weeklyMondays.has(monday),
      });
    }
    return weeks;
  }, [data.reviews, today]);

  const reviewTotals = useMemo(() => {
    let reviewed = 0;
    let tracked = 0;
    for (const week of reviewWeeks) {
      for (const cell of week.days) {
        if (cell.future) continue;
        tracked += 1;
        if (cell.reviewed) reviewed += 1;
      }
    }
    const weekly = reviewWeeks.filter((week) => week.weekly).length;
    return { reviewed, tracked, weekly };
  }, [reviewWeeks]);

  const streak = useMemo<number>(() => reviewStreak(data, today), [data, today]);

  /* ---- copy + gates ---- */

  const history = useMemo<number>(() => historyDayCount(data), [data]);
  const sparse = history < MIN_HISTORY_DAYS;

  const momentumTone = momentum >= 70 ? 'green' : momentum < 40 ? 'amber' : 'default';

  /* ---- chart props built from the resolved tokens ---- */

  const axisTick = useMemo(() => ({ fill: palette.tick, fontSize: 11 }), [palette.tick]);
  const axisTickSm = useMemo(() => ({ fill: palette.tick, fontSize: 10.5 }), [palette.tick]);

  /** The wash a hovered bar sits in. */
  const barCursor = useMemo(
    () => ({ fill: palette.azure, fillOpacity: 0.07 }),
    [palette.azure],
  );

  /** The vertical hairline that follows the pointer across the area chart. */
  const lineCursor = useMemo(
    () => ({
      stroke: palette.azure,
      strokeOpacity: 0.45,
      strokeWidth: 1,
      strokeDasharray: '4 4',
    }),
    [palette.azure],
  );

  const pillTransition = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 380, damping: 32 } as const);

  const rangeLabel = days === 7 ? 'the last seven days' : `the last ${days} days`;

  const momentumCaption =
    scheduledTotal === 0
      ? 'Nothing was scheduled in this window, so there is no follow-through to measure yet.'
      : `${plannedDays} of ${days} days carried a plan · averaging ${completionRate}% completion on them.`;

  return (
    <div ref={rootRef} className="space-y-4 sm:space-y-5">
      {/* =============================================================
          1 — header + range
          ============================================================= */}
      <motion.section
        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: HOUSE_EASE }}
        className="pa-panel p-5 sm:p-6"
      >
        <SectionHeader
          eyebrow="Analytics"
          title="Insights"
          subtitle={`Reading ${rangeLabel} — what the system says you did, not what you meant to do.`}
          icon={TrendingUp}
          action={
            <div className="pa-seg" role="group" aria-label="Range">
              {RANGES.map((range) => {
                const active = range === days;
                return (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setDays(range)}
                    data-active={active}
                    aria-pressed={active}
                    aria-label={`Last ${range} days`}
                    className={clsx('pa-seg-btn', PILL_FOCUS)}
                  >
                    {active ? (
                      <motion.span
                        layoutId="pa-insights-range-pill"
                        className="pa-seg-pill"
                        transition={pillTransition}
                      />
                    ) : null}
                    <span className="relative z-[1] tabular-nums">{range}d</span>
                  </button>
                );
              })}
            </div>
          }
        />
      </motion.section>

      {/* =============================================================
          2 — the four numbers
          ============================================================= */}
      <motion.section
        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.05 }}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <StatTile
          label="Tasks completed"
          value={completedInRange}
          icon={ListChecks}
          hint={`Finished in ${rangeLabel}`}
        />
        <StatTile
          label="Completion rate"
          value={completionRate}
          suffix="%"
          icon={Gauge}
          tone={completionRate >= 70 ? 'green' : completionRate < 40 ? 'amber' : 'default'}
          hint={
            scheduledTotal === 0
              ? 'Nothing scheduled in this window'
              : `${completedOnPlan} of ${scheduledTotal} scheduled tasks`
          }
        />
        <StatTile
          label="Momentum"
          value={momentum}
          suffix="/ 100"
          icon={Activity}
          tone={momentumTone}
          hint="7-day blend of tasks kept, habits logged and reviews written"
        />
        <StatTile
          label="Longest streak"
          value={streakLeader === null ? 0 : streakLeader.current}
          suffix={streakLeader === null ? undefined : plural(streakLeader.current, 'day', 'days')}
          icon={Flame}
          hint={
            streakLeader === null
              ? 'No habits being tracked yet'
              : streakLeader.current > 0
                ? `${streakLeader.name} · best ever ${streakLeader.best}`
                : 'Every run is currently cold — start one today'
          }
        />
      </motion.section>

      {sparse ? (
        /* =============================================================
           7 — not enough history to draw anything honest
           ============================================================= */
        <motion.section
          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.1 }}
          className="pa-panel p-5 sm:p-6"
        >
          <EmptyState
            icon={LineChartIcon}
            title="Not enough data yet"
            description="Use the system for a few days and this fills in."
          />
        </motion.section>
      ) : (
        <>
          {/* =============================================================
              3 — momentum
              ============================================================= */}
          <motion.section
            initial={{ opacity: 0, y: reduce ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.1 }}
            className="pa-panel p-5 sm:p-6"
          >
            <SectionHeader
              eyebrow="Follow-through"
              title="Momentum"
              subtitle={momentumCaption}
              icon={Activity}
            />

            {scheduledTotal === 0 ? (
              <EmptyState
                icon={Activity}
                title="No plan to measure"
                description="Schedule a few tasks onto days and the shape of your weeks appears here."
              />
            ) : (
              <>
                <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-4 rounded-full"
                      style={{
                        background:
                          'linear-gradient(90deg, var(--pa-azure), color-mix(in srgb, var(--pa-azure) 30%, transparent))',
                      }}
                    />
                    <span className="text-[11.5px] leading-none text-[color:var(--pa-muted)]">
                      Daily completion
                    </span>
                  </span>

                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-0 w-4 border-t-[1.5px] border-dashed"
                      style={{ borderColor: 'var(--pa-faint)' }}
                    />
                    <span className="text-[11.5px] leading-none text-[color:var(--pa-muted)]">
                      Average {completionRate}%
                    </span>
                  </span>

                  <span className="text-[11.5px] leading-none text-[color:var(--pa-faint)]">
                    Gaps are days with nothing scheduled
                  </span>
                </div>

                <div className="mt-4 h-[240px] sm:h-[290px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        {/* `stopOpacity` rather than an rgba literal, so the fade
                            is expressed once and the hue follows the token. */}
                        <linearGradient id="pa-area-momentum" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={palette.azure} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={palette.azure} stopOpacity={0} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={palette.grid}
                        vertical={false}
                      />

                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={axisTick}
                        tickMargin={10}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 50, 100]}
                        tickFormatter={(value: number) => `${value}%`}
                        axisLine={false}
                        tickLine={false}
                        tick={axisTick}
                        width={40}
                      />

                      <Tooltip
                        trigger={narrow ? 'click' : 'hover'}
                        cursor={lineCursor}
                        content={<MomentumTooltip />}
                        wrapperStyle={{ outline: 'none' }}
                      />

                      <ReferenceLine
                        y={completionRate}
                        stroke={palette.reference}
                        strokeDasharray="5 5"
                        strokeWidth={1}
                      />

                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={palette.azure}
                        strokeWidth={2}
                        fill="url(#pa-area-momentum)"
                        connectNulls={false}
                        dot={
                          series.length > 45
                            ? { r: 1.6, fill: palette.azure, strokeWidth: 0 }
                            : { r: 2.6, fill: palette.paper, stroke: palette.azure, strokeWidth: 1.6 }
                        }
                        activeDot={{
                          r: 4.5,
                          fill: palette.paper,
                          stroke: palette.azure,
                          strokeWidth: 2,
                        }}
                        isAnimationActive={!reduce}
                        animationDuration={700}
                        animationEasing="ease-out"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </motion.section>

          {/* =============================================================
              4 — the split
              ============================================================= */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
            {/* ---- where the effort went ---- */}
            <motion.section
              initial={{ opacity: 0, y: reduce ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.15 }}
              className="pa-panel flex flex-col p-5 sm:p-6"
            >
              <SectionHeader
                eyebrow="Attention"
                title="Where your effort goes"
                subtitle={
                  completedInRange === 0
                    ? 'Completed work, split by the life area it laddered up to.'
                    : `${completedInRange} completed ${plural(completedInRange, 'task', 'tasks')}, split by the life area it laddered up to.`
                }
                icon={Layers}
              />

              {areaRows.length === 0 ? (
                <EmptyState
                  icon={Layers}
                  title="Nothing finished yet"
                  description="Tick something off and the areas your effort is landing in show up here."
                />
              ) : (
                <div
                  className="mt-5"
                  style={{ height: Math.max(150, areaRows.length * 42 + 16) }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={areaRows}
                      layout="vertical"
                      margin={{ top: 0, right: 36, bottom: 0, left: 0 }}
                      barCategoryGap="28%"
                    >
                      <XAxis type="number" hide allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={narrow ? 84 : 112}
                        axisLine={false}
                        tickLine={false}
                        tick={axisTick}
                        tickFormatter={(value: string) => truncate(value, 15)}
                      />

                      <Tooltip
                        trigger={narrow ? 'click' : 'hover'}
                        cursor={barCursor}
                        content={<AreaTooltip />}
                        wrapperStyle={{ outline: 'none' }}
                      />

                      <Bar
                        dataKey="completed"
                        radius={[0, 6, 6, 0]}
                        maxBarSize={18}
                        isAnimationActive={!reduce}
                        animationDuration={700}
                        animationEasing="ease-out"
                      >
                        {areaRows.map((row) => (
                          <Cell key={row.key} fill={row.color} />
                        ))}
                        <LabelList
                          dataKey="completed"
                          position="right"
                          offset={10}
                          fill={palette.label}
                          fontSize={11}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </motion.section>

            {/* ---- habit consistency ---- */}
            <motion.section
              initial={{ opacity: 0, y: reduce ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.2 }}
              className="pa-panel flex flex-col p-5 sm:p-6"
            >
              <SectionHeader
                eyebrow="Reliability"
                title="Habit consistency"
                subtitle={
                  habitRows.length > MAX_HABIT_BARS
                    ? `Logged ÷ due across ${rangeLabel} — top ${MAX_HABIT_BARS} of ${habitRows.length} habits.`
                    : `Logged ÷ due across ${rangeLabel}.`
                }
                icon={Repeat}
              />

              {habitBars.length === 0 ? (
                <EmptyState
                  icon={Repeat}
                  title="No habits to measure"
                  description="Habits are the compounding half of the system — one is enough to start."
                />
              ) : (
                <>
                  <div className="mt-5 flex flex-wrap items-center gap-1.5">
                    {habitBars.map((bar) => (
                      <span
                        key={bar.habitId}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color:var(--pa-line)] bg-[color:var(--pa-tile)] py-1 pl-2.5 pr-1.5"
                        data-tip={`${bar.name} — ${bar.value}% consistent`}
                      >
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{
                            background:
                              bar.habitId === leadHabitId ? 'var(--pa-violet)' : 'var(--pa-azure)',
                          }}
                        />
                        <span className="max-w-[12ch] truncate text-[11.5px] leading-none text-[color:var(--pa-muted)]">
                          {bar.name}
                        </span>
                        <StreakChip count={bar.current} />
                      </span>
                    ))}
                  </div>

                  {leadHabitId === null ? null : (
                    <p className="mt-2.5 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                      Violet marks your most consistent habit.
                    </p>
                  )}

                  {/* A rail below `sm`. Eight `interval={0}` labels need ~376px and the
                      panel gives 244px, so they overlapped into a smear — and with
                      the shell on `overflow-x: clip` there is no scrolling to it.
                      `sm:min-w-0` leaves the desktop chart byte-identical. */}
                  <div className="pa-scroll-x -mx-1 mt-4 px-1" data-fade="true">
                  <div className="h-[220px] min-w-[440px] sm:h-[248px] sm:min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={habitBars}
                        margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
                        barCategoryGap="30%"
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={palette.grid}
                          vertical={false}
                        />

                        <XAxis
                          dataKey="short"
                          axisLine={false}
                          tickLine={false}
                          tick={axisTickSm}
                          tickMargin={9}
                          interval={0}
                        />
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 50, 100]}
                          tickFormatter={(value: number) => `${value}%`}
                          axisLine={false}
                          tickLine={false}
                          tick={axisTick}
                          width={40}
                        />

                        <Tooltip
                          trigger={narrow ? 'click' : 'hover'}
                          cursor={barCursor}
                          content={<HabitTooltip />}
                          wrapperStyle={{ outline: 'none' }}
                        />

                        <Bar
                          dataKey="value"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={34}
                          isAnimationActive={!reduce}
                          animationDuration={700}
                          animationEasing="ease-out"
                        >
                          {habitBars.map((bar) => (
                            <Cell
                              key={bar.habitId}
                              fill={bar.habitId === leadHabitId ? palette.violet : palette.azure}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </div>
                </>
              )}
            </motion.section>
          </div>

          {/* =============================================================
              5 — the ladder
              ============================================================= */}
          <motion.section
            initial={{ opacity: 0, y: reduce ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.25 }}
            className="pa-panel p-5 sm:p-6"
          >
            <SectionHeader
              eyebrow="Progress"
              title="Goal ladder"
              subtitle={
                goalRows.length === 0
                  ? 'Every active goal, ranked by how far it has actually moved.'
                  : `${goalRows.length} active ${plural(goalRows.length, 'goal', 'goals')}, ranked by how far each has actually moved.`
              }
              icon={Target}
            />

            {goalRows.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No active goals"
                description="Progress needs somewhere to point. Name one outcome and the ladder builds itself."
              />
            ) : (
              <ul className="mt-5 space-y-1.5">
                <AnimatePresence initial={false}>
                  {goalRows.map((row, index) => (
                    <GoalLadderRow
                      key={row.goal.id}
                      row={row}
                      rank={index + 1}
                      reduce={Boolean(reduce)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </motion.section>

          {/* =============================================================
              6 — reviews
              ============================================================= */}
          <motion.section
            initial={{ opacity: 0, y: reduce ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.3 }}
            className="pa-panel p-5 sm:p-6"
          >
            <SectionHeader
              eyebrow="Looking back"
              title="Review consistency"
              subtitle="Eight weeks of shutdowns. The habit of looking back is the one that keeps the rest of this honest."
              icon={NotebookPen}
            />

            <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-9">
              {/* ---- the strip ---- */}
              <div className="pa-scroll-x -mx-1 shrink-0 px-1 py-1">
                <div
                  className="flex items-start gap-[4px]"
                  role="img"
                  aria-label={`Daily reviews across the last ${REVIEW_WEEKS} weeks: ${reviewTotals.reviewed} of ${reviewTotals.tracked} days written.`}
                >
                  <div className="mr-1 flex w-4 flex-col gap-[4px]">
                    {REVIEW_ROW_LABELS.map((label, index) => (
                      <span
                        key={`row-${index}`}
                        aria-hidden="true"
                        className="flex h-3 items-center text-[9px] leading-none text-[color:var(--pa-faint)]"
                      >
                        {label}
                      </span>
                    ))}
                    <span
                      aria-hidden="true"
                      className="mt-[7px] flex h-3 items-center text-[9px] leading-none text-[color:var(--pa-faint)]"
                    >
                      Wk
                    </span>
                  </div>

                  {reviewWeeks.map((week) => (
                    <div key={week.monday} className="flex flex-col gap-[4px]">
                      {week.days.map((cell) => (
                        <span
                          key={cell.day}
                          className="pa-heat-cell size-3"
                          data-level={cell.reviewed ? '4' : '0'}
                          data-today={cell.day === today ? 'true' : 'false'}
                          style={cell.future ? { opacity: 0.4 } : undefined}
                          data-tip={`${formatKey(cell.day, 'EEE d MMM')} — ${
                            cell.future
                              ? 'still to come'
                              : cell.reviewed
                                ? 'shutdown written'
                                : 'no review'
                          }`}
                        />
                      ))}

                      <span
                        className="pa-heat-cell mt-[7px] size-3"
                        data-level={week.weekly ? '3' : '0'}
                        data-tip={`Week of ${week.label} — ${
                          week.weekly ? 'weekly review written' : 'no weekly review'
                        } · ${week.count}/7 daily`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ---- the numbers ---- */}
              <div className="min-w-0 flex-1">
                <p className={MICRO_LABEL}>Current streak</p>
                <p className="mt-2.5 flex items-baseline gap-2">
                  <span className="pa-stat text-[2rem] tabular-nums">{streak}</span>
                  <span className="text-[12.5px] leading-none text-[color:var(--pa-muted)]">
                    {streak === 0
                      ? 'days — tonight restarts it'
                      : `${plural(streak, 'day', 'days')} in a row`}
                  </span>
                </p>

                <div className="mt-5 max-w-[420px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] leading-none text-[color:var(--pa-muted)]">
                      Last {REVIEW_WEEKS} weeks
                    </span>
                    <span className="text-[12px] tabular-nums leading-none text-[color:var(--pa-navy)]">
                      {reviewTotals.reviewed} of {reviewTotals.tracked} days
                    </span>
                  </div>
                  <Meter
                    value={
                      reviewTotals.tracked === 0
                        ? 0
                        : reviewTotals.reviewed / reviewTotals.tracked
                    }
                    thin
                    className="mt-2.5"
                  />
                </div>

                <p className="mt-4 flex items-center gap-2 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                  <CalendarCheck className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                  {reviewTotals.weekly} of the last {REVIEW_WEEKS} weeks closed with a weekly review.
                </p>
              </div>
            </div>
          </motion.section>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Goal ladder row
 * ---------------------------------------------------------------------- */

export interface GoalLadderRowProps {
  row: GoalRowModel;
  rank: number;
  reduce: boolean;
}

function GoalLadderRow({ row, rank, reduce }: GoalLadderRowProps): JSX.Element {
  const { goal, progress, area } = row;
  const value = percent(progress.ratio);
  /* An unfiled goal borrows the tertiary ink rather than a navy literal, so its
   * dot stays visible once the stage turns navy-black. */
  const accent = area ? area.color : 'var(--pa-faint)';

  return (
    <motion.li
      layout={reduce ? false : 'position'}
      initial={{ opacity: 0, y: reduce ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -8 }}
      transition={{
        duration: 0.32,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(rank * 0.03, 0.24),
      }}
    >
      <button
        type="button"
        onClick={() => openGoalInGoals(goal.id)}
        aria-label={`Open goal: ${goal.title} — ${value}% complete`}
        data-tip={`${goal.title} · ${basisLabel(progress)}`}
        className={clsx(
          'pa-row pa-row-hover pa-focus group flex w-full items-center gap-3 px-3.5 py-3 text-left',
          'sm:gap-4 sm:px-4',
        )}
      >
        <span className="w-4 shrink-0 text-right text-[11.5px] tabular-nums leading-none text-[color:var(--pa-faint)]">
          {rank}
        </span>

        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ background: accent, boxShadow: area ? `0 0 0 3px ${area.color}1a` : undefined }}
        />

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] leading-snug text-[color:var(--pa-navy)]">
              {goal.title}
            </span>
            <span className="pa-badge hidden shrink-0 sm:inline-flex">
              {HORIZON_LABEL[goal.horizon]}
            </span>
          </span>

          <span className="mt-1 block text-[11.5px] leading-none text-[color:var(--pa-faint)]">
            {basisLabel(progress)}
          </span>

          {/* On a narrow screen the meter rides under the title instead of beside it. */}
          <span className="mt-2.5 block sm:hidden">
            <Meter value={progress.ratio} thin />
          </span>
        </span>

        <span className="hidden w-[140px] shrink-0 lg:block">
          <Meter value={progress.ratio} thin />
        </span>

        <span className="w-10 shrink-0 text-right text-[13px] tabular-nums leading-none text-[color:var(--pa-navy)]">
          {value}%
        </span>

        <ChevronRight
          className="size-3.5 shrink-0 text-[color:var(--pa-faint)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
          strokeWidth={1.9}
          aria-hidden="true"
        />
      </button>
    </motion.li>
  );
}

/* -------------------------------------------------------------------------
 * Tooltips — recharts clones these with its own props, so each one declares
 * exactly the shape it reads and nothing more.
 * ---------------------------------------------------------------------- */

export interface MomentumTooltipProps {
  active?: boolean;
  payload?: { payload?: MomentumPoint }[];
}

function MomentumTooltip({ active, payload }: MomentumTooltipProps): JSX.Element | null {
  const point = active === true ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  return (
    <div className="pa-tile p-2.5" style={TOOLTIP_SURFACE}>
      <p className="pa-eyebrow leading-none">{formatKey(point.date, 'EEE d MMM')}</p>

      {point.scheduled === 0 ? (
        <p className="mt-2 text-[12px] leading-none text-[color:var(--pa-muted)]">
          Nothing scheduled
        </p>
      ) : (
        <p className="mt-2 flex items-baseline gap-1.5 leading-none">
          <span className="text-[15px] font-medium tabular-nums text-[color:var(--pa-navy)]">
            {point.value}%
          </span>
          <span className="text-[11.5px] text-[color:var(--pa-faint)]">
            {point.completed} of {point.scheduled} done
          </span>
        </p>
      )}
    </div>
  );
}

export interface AreaTooltipProps {
  active?: boolean;
  payload?: { payload?: AreaBar }[];
}

function AreaTooltip({ active, payload }: AreaTooltipProps): JSX.Element | null {
  const row = active === true ? payload?.[0]?.payload : undefined;
  if (!row) return null;

  return (
    <div className="pa-tile p-2.5" style={TOOLTIP_SURFACE}>
      <p className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: row.color }}
        />
        <span className="pa-eyebrow leading-none">{row.name}</span>
      </p>
      <p className="mt-2 flex items-baseline gap-1.5 leading-none">
        <span className="text-[15px] font-medium tabular-nums text-[color:var(--pa-navy)]">
          {row.completed}
        </span>
        <span className="text-[11.5px] text-[color:var(--pa-faint)]">
          {plural(row.completed, 'task completed', 'tasks completed')}
        </span>
      </p>
    </div>
  );
}

export interface HabitTooltipProps {
  active?: boolean;
  payload?: { payload?: HabitBar }[];
}

function HabitTooltip({ active, payload }: HabitTooltipProps): JSX.Element | null {
  const bar = active === true ? payload?.[0]?.payload : undefined;
  if (!bar) return null;

  return (
    <div className="pa-tile p-2.5" style={TOOLTIP_SURFACE}>
      <p className="pa-eyebrow leading-none">{bar.name}</p>
      <p className="mt-2 flex items-baseline gap-1.5 leading-none">
        <span className="text-[15px] font-medium tabular-nums text-[color:var(--pa-navy)]">
          {bar.value}%
        </span>
        <span className="text-[11.5px] text-[color:var(--pa-faint)]">of the days it was due</span>
      </p>
      <p className="mt-2 text-[11.5px] leading-none text-[color:var(--pa-muted)]">
        {bar.current}-day streak · best ever {bar.best}
      </p>
    </div>
  );
}
