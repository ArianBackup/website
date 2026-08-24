'use client';

/* ---------------------------------------------------------------------------
 * goals-view.tsx — THE CASCADE.
 *
 * The surface where a ten-year sentence becomes a ninety-day outcome. Three
 * bands, read top to bottom:
 *
 *   1. the header      counts, the one big action, and every filter
 *   2. the area strip  how each part of life is actually doing
 *   3. the grid        goals grouped Vision → Year → Quarter
 *
 * Filtering is deliberately non-destructive: the horizon control and the area
 * pills narrow the grid, they never hide the fact that something exists — the
 * area chips carry their own counts so an empty result is explained before you
 * see it.
 *
 * Opening a card hands off to <GoalDetailDialog>; the command palette can do
 * the same from anywhere by dispatching `assistant:open-goal`.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import {
  CalendarDays,
  CornerLeftUp,
  Layers,
  ListTodo,
  Pause,
  Plus,
  SlidersHorizontal,
  Target,
  Trophy,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

import { daysBetween, relativeDayLabel } from '../../lib/dates';
import { areaProgress, goalProgress, goalTasks } from '../../lib/derive';
import { iconFor } from '../../lib/icons';
import { useAssistant } from '../../lib/store';
import type { DayKey, Goal, GoalHorizon, ID, LifeArea } from '../../lib/types';

import { OPEN_GOAL_EVENT } from '../shared/command-palette';
import { EmptyState } from '../shared/empty-state';
import { Meter } from '../shared/meter';
import { SectionHeader } from '../shared/section-header';

import {
  GLASS_FOCUS,
  GoalComposerDialog,
  GoalDetailDialog,
  HORIZON_LABEL,
} from './goal-detail-dialog';

/* -------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------- */

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

const HORIZON_ORDER: GoalHorizon[] = ['vision', 'year', 'quarter'];

/** The short form used on a card, where the group heading already gives context. */
const HORIZON_BADGE: Record<GoalHorizon, string> = {
  vision: 'Vision',
  year: 'Year',
  quarter: 'Quarter',
};

type HorizonFilter = 'all' | GoalHorizon;

const HORIZON_FILTERS: { id: HorizonFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'vision', label: 'Vision' },
  { id: 'year', label: 'Year' },
  { id: 'quarter', label: 'Quarter' },
];

/** Keeps a pill's shape while focused, which `.pa-focus` would square off. */
const PILL_FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--pa-accent-ring)]';

/* The full-card hit target sits inside an `overflow-hidden` card, which would
 * clip an outward ring away entirely — so its focus ring is drawn inset. It
 * uses the full-strength brand azure rather than a wash: at two pixels, inside
 * a busy card, anything softer disappears on the dark stage. */
const COVER_FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--pa-azure)]';

/* A status hairline at reduced alpha. `--pa-green` differs between themes, so
 * the edge is mixed from the token rather than written out. */
const GREEN_EDGE = 'color-mix(in srgb, var(--pa-green) 45%, transparent)';

/* -------------------------------------------------------------------------
 * Small pure helpers
 * ---------------------------------------------------------------------- */

/** A target date is amber inside a fortnight and red once it has slipped. */
function dateTone(
  targetDate: DayKey | null,
  refDay: DayKey,
  achieved: boolean,
): 'amber' | 'red' | undefined {
  if (targetDate === null || achieved) return undefined;
  const delta = daysBetween(refDay, targetDate);
  if (delta < 0) return 'red';
  if (delta <= 14) return 'amber';
  return undefined;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/* -------------------------------------------------------------------------
 * The view model
 * ---------------------------------------------------------------------- */

interface GoalCardModel {
  goal: Goal;
  area: LifeArea | null;
  parent: Goal | null;
  ratio: number;
  /** What the ratio is made of, said honestly. */
  caption: string;
  openTasks: number;
  achieved: boolean;
  paused: boolean;
}

interface AreaStripItem {
  area: LifeArea;
  ratio: number;
  goals: number;
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function GoalsView(): JSX.Element {
  /* `today` is the store's live day — it rolls over on the clock, so a card's
   * "3 days left" re-reads itself at midnight without a reload. */
  const { data, actions, today } = useAssistant();
  const reduce = useReducedMotion();

  const [areaFilter, setAreaFilter] = useState<ID | null>(null);
  const [horizonFilter, setHorizonFilter] = useState<HorizonFilter>('all');
  const [showAchieved, setShowAchieved] = useState(false);
  const [detailGoalId, setDetailGoalId] = useState<ID | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  /* ---- the palette (and anything else) can open a goal from anywhere ---- */
  useEffect(() => {
    const onOpenGoal = (event: Event): void => {
      const detail = (event as CustomEvent<{ goalId?: unknown }>).detail;
      const goalId = detail && typeof detail.goalId === 'string' ? detail.goalId : null;
      if (goalId !== null) setDetailGoalId(goalId);
    };
    window.addEventListener(OPEN_GOAL_EVENT, onOpenGoal);
    return () => window.removeEventListener(OPEN_GOAL_EVENT, onOpenGoal);
  }, []);

  /* ---- everything derived, once ---- */

  const areasById = useMemo<Map<ID, LifeArea>>(
    () => new Map(data.areas.map((area): [ID, LifeArea] => [area.id, area])),
    [data.areas],
  );

  /** The owner's own arrangement, used by both the filter pills and the strip. */
  const sortedAreas = useMemo<LifeArea[]>(
    () => [...data.areas].sort((a, b) => a.order - b.order),
    [data.areas],
  );

  const counts = useMemo(() => {
    let active = 0;
    let achieved = 0;
    let paused = 0;
    for (const goal of data.goals) {
      if (goal.status === 'active') active += 1;
      else if (goal.status === 'achieved') achieved += 1;
      else if (goal.status === 'paused') paused += 1;
    }
    return { active, achieved, paused };
  }, [data.goals]);

  /** Everything live, before any filter — archived goals are simply gone. */
  const liveGoals = useMemo<Goal[]>(
    () =>
      data.goals
        .filter((goal) => goal.status !== 'archived')
        .sort((a, b) => {
          // Finished work sinks to the bottom of its group.
          const fa = a.status === 'achieved' ? 1 : 0;
          const fb = b.status === 'achieved' ? 1 : 0;
          if (fa !== fb) return fa - fb;
          if (a.order !== b.order) return a.order - b.order;
          return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
        }),
    [data.goals],
  );

  /** The horizon + achieved filters applied — the set the area counts describe. */
  const scoped = useMemo<Goal[]>(
    () =>
      liveGoals.filter((goal) => {
        if (!showAchieved && goal.status === 'achieved') return false;
        if (horizonFilter !== 'all' && goal.horizon !== horizonFilter) return false;
        return true;
      }),
    [liveGoals, showAchieved, horizonFilter],
  );

  const areaCounts = useMemo<Map<ID | null, number>>(() => {
    const map = new Map<ID | null, number>();
    for (const goal of scoped) {
      const key = goal.areaId;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [scoped]);

  const cards = useMemo<GoalCardModel[]>(
    () =>
      scoped
        .filter((goal) => areaFilter === null || goal.areaId === areaFilter)
        .map((goal): GoalCardModel => {
          const progress = goalProgress(data, goal.id);
          const achieved = goal.status === 'achieved';
          const tasks = goalTasks(data, goal.id);

          const caption =
            progress.basis === 'milestones'
              ? `${progress.done} of ${progress.total} ${plural(progress.total, 'milestone', 'milestones')}`
              : progress.basis === 'tasks'
                ? `${progress.done} of ${progress.total} linked ${plural(progress.total, 'task', 'tasks')}`
                : progress.basis === 'goals'
                  ? `Across ${progress.total} ${plural(progress.total, 'goal', 'goals')} beneath it`
                  : 'No milestones yet';

          return {
            goal,
            area: goal.areaId === null ? null : (areasById.get(goal.areaId) ?? null),
            parent:
              goal.parentGoalId === null
                ? null
                : (data.goals.find((g) => g.id === goal.parentGoalId) ?? null),
            ratio: achieved ? 1 : progress.ratio,
            caption,
            openTasks: tasks.filter((task) => task.completedAt === null).length,
            achieved,
            paused: goal.status === 'paused',
          };
        }),
    [scoped, areaFilter, data, areasById],
  );

  /** Grouped by horizon, each group carrying the stagger offset for its cards. */
  const groups = useMemo(() => {
    let offset = 0;
    return HORIZON_ORDER.map((horizon) => {
      const items = cards.filter((card) => card.goal.horizon === horizon);
      const group = { horizon, items, offset };
      offset += items.length;
      return group;
    }).filter((group) => group.items.length > 0);
  }, [cards]);

  const strip = useMemo<AreaStripItem[]>(
    () =>
      sortedAreas.map((area): AreaStripItem => {
        const progress = areaProgress(data, area.id);
        return { area, ratio: progress.ratio, goals: progress.goals };
      }),
    [data, sortedAreas],
  );

  /* ---- interactions ---- */

  /* The acknowledgement is the toast plus the card settling into its achieved
   * state and the area strip above it re-averaging — no separate flourish. */
  const completeGoal = useCallback(
    (goal: Goal): void => {
      actions.setGoalStatus(goal.id, 'achieved');
      toast.success('Goal achieved', { description: goal.title });
    },
    [actions],
  );

  const clearFilters = useCallback((): void => {
    setAreaFilter(null);
    setHorizonFilter('all');
    setShowAchieved(false);
  }, []);

  const pillTransition = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 380, damping: 32 } as const);

  const hasGoals = liveGoals.length > 0;
  /** True whenever the grid is showing less than everything that exists. */
  const filtered = cards.length !== liveGoals.length;

  /** Remounting the grid on a filter change replays the entrance cascade. */
  const gridKey = `${areaFilter ?? 'all'}:${horizonFilter}:${showAchieved ? 'a' : 'o'}`;

  const subtitle = [
    `${counts.active} active`,
    `${counts.achieved} achieved`,
    counts.paused > 0 ? `${counts.paused} paused` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* =============================================================
          1 — header + filters
          ============================================================= */}
      <motion.section
        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: HOUSE_EASE }}
        className="pa-panel p-5 sm:p-6"
      >
        <SectionHeader
          eyebrow="The cascade"
          title="Goals"
          subtitle={
            hasGoals
              ? `${subtitle} — every task you finish should trace its way back to one of these.`
              : 'Vision at the top, ninety-day outcomes at the bottom. Everything else follows.'
          }
          icon={Target}
          /* Exactly one haze-light pill is on screen at a time: when there is
             nothing to show, the empty state below carries it instead and this
             slot stays empty rather than competing with it. */
          action={
            hasGoals ? (
              <GlassButton
                className="glass-button--haze-light shrink-0"
                size="none"
                type="button"
                buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                contentClassName={GLASS_BOX.h10.content}
                onClick={() => setComposerOpen(true)}
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="size-4" aria-hidden="true" />
                  New goal
                </span>
              </GlassButton>
            ) : undefined
          }
        />

        {hasGoals ? (
          <>
            <span className="pa-divider mt-5 block" aria-hidden="true" />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
              {/* ---- life areas ---- */}
              <div className="min-w-0 max-w-full">
                <div role="group" aria-label="Filter by life area" className="pa-seg flex-wrap">
                  <FilterPill
                    active={areaFilter === null}
                    onSelect={() => setAreaFilter(null)}
                    layoutId="pa-area-pill"
                    transition={pillTransition}
                    label="All"
                    count={scoped.length}
                    leading={
                      <Layers
                        className="size-3.5 shrink-0 opacity-70"
                        strokeWidth={1.9}
                        aria-hidden="true"
                      />
                    }
                  />

                  {sortedAreas.map((area) => (
                    <FilterPill
                      key={area.id}
                      active={areaFilter === area.id}
                      onSelect={() => setAreaFilter(area.id)}
                      layoutId="pa-area-pill"
                      transition={pillTransition}
                      label={area.name}
                      count={areaCounts.get(area.id) ?? 0}
                      leading={
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: area.color }}
                        />
                      }
                    />
                  ))}
                </div>
              </div>

              {/* ---- horizon + achieved ---- */}
              <div className="flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Filter by horizon" className="pa-seg">
                  {HORIZON_FILTERS.map((option) => {
                    const active = horizonFilter === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setHorizonFilter(option.id)}
                        data-active={active}
                        aria-pressed={active}
                        className="pa-seg-btn pa-focus"
                      >
                        {active ? (
                          <motion.span
                            layoutId="pa-horizon-pill"
                            className="pa-seg-pill"
                            transition={pillTransition}
                          />
                        ) : null}
                        <span className="relative z-[1]">{option.label}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setShowAchieved((value) => !value)}
                  aria-pressed={showAchieved}
                  data-tip={showAchieved ? 'Hide achieved goals' : 'Show achieved goals'}
                  style={showAchieved ? { borderColor: GREEN_EDGE } : undefined}
                  className={clsx(
                    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5',
                    'text-[12.5px] font-medium transition-colors duration-150',
                    PILL_FOCUS,
                    showAchieved
                      ? 'bg-[color:var(--pa-green-bg)] text-[color:var(--pa-green)]'
                      : clsx(
                          'border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)]',
                          'text-[color:var(--pa-muted)]',
                          'hover:border-[color:var(--pa-accent-ring)] hover:text-[color:var(--pa-navy)]',
                        ),
                  )}
                >
                  <Trophy className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                  Achieved
                  <span className="tabular-nums opacity-60">{counts.achieved}</span>
                </button>
              </div>
            </div>
          </>
        ) : null}
      </motion.section>

      {/* =============================================================
          2 — area progress strip
          ============================================================= */}
      {hasGoals && strip.length > 0 ? (
        <motion.section
          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.05 }}
          className="pa-panel p-5 sm:p-6"
        >
          <div className="mb-4 flex items-center gap-2.5">
            <h2 className="pa-eyebrow leading-none">Life areas</h2>
            <span className="pa-divider flex-1" aria-hidden="true" />
            <p className="text-[11.5px] leading-none text-[color:var(--pa-faint)]">
              Averaged over the goals that can be measured
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {strip.map((item, index) => (
              <AreaTile
                key={item.area.id}
                item={item}
                index={index}
                active={areaFilter === item.area.id}
                reduce={Boolean(reduce)}
                onSelect={() =>
                  setAreaFilter((current) => (current === item.area.id ? null : item.area.id))
                }
              />
            ))}
          </div>
        </motion.section>
      ) : null}

      {/* =============================================================
          3 — the grid
          ============================================================= */}
      {!hasGoals ? (
        <section className="pa-panel p-5 sm:p-6">
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Start at the top. Write the vision first, then break it into the year and the quarter that get you there."
            action={
              /* The hero size: on a surface with nothing else on it, this is
                 the only thing to do. */
              <GlassButton
                className="glass-button--haze-light"
                size="none"
                type="button"
                buttonClassName={clsx(GLASS_BOX.h11.button, GLASS_FOCUS)}
                contentClassName={GLASS_BOX.h11.content}
                onClick={() => setComposerOpen(true)}
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="size-4" aria-hidden="true" />
                  Create your first goal
                </span>
              </GlassButton>
            }
          />
        </section>
      ) : cards.length === 0 ? (
        <section className="pa-panel p-5 sm:p-6">
          <EmptyState
            icon={SlidersHorizontal}
            title="Nothing under this filter"
            description={
              showAchieved
                ? 'No goals match this combination of life area and horizon.'
                : 'No live goals match this combination — you may have achieved them all.'
            }
            action={
              <button
                type="button"
                onClick={clearFilters}
                className={clsx('pa-cta h-10 px-5 text-[13.5px]', PILL_FOCUS)}
              >
                Clear filters
              </button>
            }
          />
        </section>
      ) : (
        <div key={gridKey} className="space-y-6 sm:space-y-7">
          {groups.map((group) => (
            <section key={group.horizon}>
              <div className="mb-3.5 flex items-center gap-2.5">
                <h2 className="pa-eyebrow leading-none">{HORIZON_LABEL[group.horizon]}</h2>
                <span className="text-[11.5px] tabular-nums leading-none text-[color:var(--pa-faint)]">
                  {group.items.length}
                </span>
                <span className="pa-divider flex-1" aria-hidden="true" />
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {group.items.map((card, index) => (
                  <GoalCard
                    key={card.goal.id}
                    card={card}
                    index={group.offset + index}
                    refDay={today}
                    reduce={Boolean(reduce)}
                    onOpen={setDetailGoalId}
                    onComplete={completeGoal}
                  />
                ))}
              </div>
            </section>
          ))}

          {filtered ? (
            <p className="pt-1 text-center text-[11.5px] text-[color:var(--pa-faint)]">
              Showing {cards.length} of {liveGoals.length} goals ·{' '}
              <button
                type="button"
                onClick={clearFilters}
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-[color:var(--pa-azure)] transition-colors duration-150',
                  'hover:bg-[color:var(--pa-accent-bg)]',
                  PILL_FOCUS,
                )}
              >
                clear filters
              </button>
            </p>
          ) : null}
        </div>
      )}

      {/* =============================================================
          dialogs
          ============================================================= */}
      <GoalDetailDialog
        goalId={detailGoalId}
        onOpenChange={(open) => {
          if (!open) setDetailGoalId(null);
        }}
      />

      <GoalComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        defaultAreaId={areaFilter}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Filter pill — the segmented-control button with a shared-element indicator
 * ---------------------------------------------------------------------- */

interface FilterPillProps {
  active: boolean;
  onSelect: () => void;
  layoutId: string;
  transition: { duration: number } | { type: 'spring'; stiffness: number; damping: number };
  label: string;
  count: number;
  leading: JSX.Element;
}

function FilterPill({
  active,
  onSelect,
  layoutId,
  transition,
  label,
  count,
  leading,
}: FilterPillProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      aria-pressed={active}
      className="pa-seg-btn pa-focus"
    >
      {active ? (
        <motion.span layoutId={layoutId} className="pa-seg-pill" transition={transition} />
      ) : null}
      <span className="relative z-[1] flex items-center gap-1.5">
        {leading}
        <span className="max-w-[16ch] truncate">{label}</span>
        <span className="tabular-nums text-[11px] opacity-55">{count}</span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Area tile — a life area's rolled-up state, and a filter
 * ---------------------------------------------------------------------- */

interface AreaTileProps {
  item: AreaStripItem;
  index: number;
  active: boolean;
  reduce: boolean;
  onSelect: () => void;
}

function AreaTile({ item, index, active, reduce, onSelect }: AreaTileProps): JSX.Element {
  const { area, ratio, goals } = item;
  const Icon = iconFor(area.icon);
  const percent = Math.round(ratio * 100);

  /* The entrance lives on a wrapper, never on the tile itself: motion leaves an
   * inline transform behind, and an inline transform beats a `:hover` rule. */
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(0.05 + index * 0.035, 0.3),
      }}
      className="min-w-0"
    >
      <div
        className={clsx(
          'pa-tile group relative overflow-hidden p-3.5',
          'transition-[transform,outline-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          'hover:-translate-y-[2px] hover:outline hover:outline-1',
          'hover:outline-[color:var(--pa-accent-ring)] motion-reduce:hover:translate-y-0',
        )}
        /* The area's own colour keeps the selected ring — it is user data and
           reads on both stages. Only the lit top edge is tokenised, since a
           white inset on the dark stage would draw a bright seam. */
        style={
          active
            ? {
                borderColor: `${area.color}66`,
                boxShadow: `var(--pa-highlight), 0 0 0 3px ${area.color}2e`,
              }
            : undefined
        }
      >
        <span
          aria-hidden="true"
          className={clsx(
            'pointer-events-none absolute -right-6 -top-8 size-20 rounded-full transition-opacity duration-200',
            active ? 'opacity-100' : 'opacity-50 group-hover:opacity-90',
          )}
          style={{ background: `radial-gradient(closest-side, ${area.color}26, transparent 74%)` }}
        />

        <button
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          aria-label={`${area.name} — ${percent} per cent across ${goals} ${plural(goals, 'goal', 'goals')}. Filter the grid to this area.`}
          className={clsx('absolute inset-0 z-[1] rounded-[1.15rem]', COVER_FOCUS)}
        />

        <div className="pointer-events-none relative z-[2]">
          <div className="flex items-center gap-2.5">
            <span
              className="pa-chip size-8 shrink-0 rounded-[0.7rem]"
              style={{
                background: `${area.color}1f`,
                color: area.color,
                boxShadow: `inset 0 0 0 1px ${area.color}33, var(--pa-highlight)`,
              }}
              aria-hidden="true"
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </span>

            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--pa-navy)]">
              {area.name}
            </span>
          </div>

          <p className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-medium tabular-nums leading-none text-[color:var(--pa-navy)]">
              {percent}
              <span className="text-[11px] text-[color:var(--pa-faint)]">%</span>
            </span>
            <span className="text-[11px] leading-none text-[color:var(--pa-faint)]">
              {goals} {plural(goals, 'goal', 'goals')}
            </span>
          </p>

          <Meter value={ratio} thin className="mt-2" />
        </div>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
 * Goal card
 * ---------------------------------------------------------------------- */

interface GoalCardProps {
  card: GoalCardModel;
  index: number;
  refDay: DayKey;
  reduce: boolean;
  onOpen: (goalId: ID) => void;
  onComplete: (goal: Goal) => void;
}

function GoalCard({ card, index, refDay, reduce, onOpen, onComplete }: GoalCardProps): JSX.Element {
  const { goal, area, parent, ratio, caption, openTasks, achieved, paused } = card;
  const tone = dateTone(goal.targetDate, refDay, achieved);
  const percent = Math.round(ratio * 100);

  /* An area's colour is a stored hex, so its tints can be built by appending an
   * alpha pair. An unfiled goal has no hex to append to and falls back to the
   * accent tokens, which already carry the right value for each theme. */
  const accent = area ? area.color : null;

  const bloom = achieved
    ? 'radial-gradient(closest-side, color-mix(in srgb, var(--pa-green) 26%, transparent), transparent 72%)'
    : accent !== null
      ? `radial-gradient(closest-side, ${accent}26, transparent 72%)`
      : 'radial-gradient(closest-side, var(--pa-accent-bg-strong), transparent 72%)';

  /* The entrance lives on a wrapper, never on `.pa-card` itself: motion leaves
   * an inline transform behind, and an inline transform beats the `:hover`
   * rule that gives the card its lift. */
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
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
          achieved && 'opacity-[0.88]',
        )}
      >
        {/* A breath of the area's colour so the card sits in light, not on paper. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-14 size-40 rounded-full"
          style={{ background: bloom }}
        />

        {/* The whole card is the target. Everything above it is inert. */}
        <button
          type="button"
          onClick={() => onOpen(goal.id)}
          aria-label={`Open goal: ${goal.title}`}
          className={clsx('absolute inset-0 z-[1] rounded-[1.35rem]', COVER_FOCUS)}
        />

        <div className="pointer-events-none relative z-[2] flex min-h-0 flex-1 flex-col">
          {/* ---- who this belongs to ---- */}
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={
                  accent !== null
                    ? { background: accent, boxShadow: `0 0 0 3px ${accent}1f` }
                    : {
                        background: 'var(--pa-azure)',
                        boxShadow: '0 0 0 3px var(--pa-accent-glow)',
                      }
                }
              />
              <span className="truncate text-[12px] text-[color:var(--pa-muted)]">
                {area ? area.name : 'Unfiled'}
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-1.5">
              {achieved ? (
                <span className="pa-badge" data-tone="green">
                  <Trophy className="size-3" strokeWidth={2} aria-hidden="true" />
                  Achieved
                </span>
              ) : paused ? (
                <span className="pa-badge" data-tone="amber">
                  <Pause className="size-3" strokeWidth={2} aria-hidden="true" />
                  Paused
                </span>
              ) : null}

              <span
                className="pa-badge"
                data-tone={goal.horizon === 'quarter' && !achieved ? 'azure' : undefined}
              >
                {HORIZON_BADGE[goal.horizon]}
              </span>
            </span>
          </div>

          {/* ---- the goal itself ---- */}
          <h3
            className={clsx(
              'mt-3 line-clamp-2 text-[15px] font-medium leading-snug tracking-tight',
              achieved ? 'text-[color:var(--pa-muted)]' : 'text-[color:var(--pa-navy)]',
            )}
          >
            {goal.title}
          </h3>

          {goal.why.trim().length > 0 ? (
            <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
              {goal.why}
            </p>
          ) : (
            <p className="mt-1.5 text-[12.5px] italic leading-relaxed text-[color:var(--pa-faint)]">
              No why written yet.
            </p>
          )}

          {/* ---- progress ---- */}
          <div className="mt-auto pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-[11.5px] text-[color:var(--pa-faint)]">
                {caption}
              </p>
              <p className="shrink-0 text-[12px] font-medium tabular-nums text-[color:var(--pa-muted)]">
                {percent}%
              </p>
            </div>
            <Meter value={ratio} complete={achieved || ratio >= 1} className="mt-2" />
          </div>

          {/* ---- footer ---- */}
          <span className="pa-divider mt-4 block" aria-hidden="true" />

          <div className="mt-3 flex items-center gap-3">
            {goal.targetDate !== null ? (
              <span
                className={clsx(
                  'inline-flex min-w-0 items-center gap-1.5 text-[11.5px]',
                  tone === 'red'
                    ? 'text-[color:var(--pa-red)]'
                    : tone === 'amber'
                      ? 'text-[color:var(--pa-amber)]'
                      : 'text-[color:var(--pa-faint)]',
                )}
                data-tip={`Target ${relativeDayLabel(goal.targetDate, refDay)}`}
              >
                <CalendarDays className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                <span className="truncate">{relativeDayLabel(goal.targetDate, refDay)}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[color:var(--pa-faint)]">
                <CalendarDays className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                No date
              </span>
            )}

            <span
              className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-[color:var(--pa-faint)]"
              data-tip={`${openTasks} open ${plural(openTasks, 'task', 'tasks')}`}
            >
              <ListTodo className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              {openTasks} open
            </span>

            <span className="flex-1" aria-hidden="true" />

            {!achieved ? (
              <button
                type="button"
                onClick={() => onComplete(goal)}
                aria-label={`Mark "${goal.title}" as achieved`}
                data-tip="Mark achieved"
                className={clsx(
                  'pa-icon-btn pointer-events-auto z-[3] size-7 shrink-0',
                  'opacity-0 transition-opacity duration-200 [@media(pointer:coarse)]:opacity-100',
                  'group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
                  PILL_FOCUS,
                )}
              >
                <Trophy className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {parent ? (
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-[color:var(--pa-faint)]">
              <CornerLeftUp className="size-3 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              <span className="truncate">
                supports <span className="text-[color:var(--pa-muted)]">{parent.title}</span>
              </span>
            </p>
          ) : null}
        </div>
      </article>
    </motion.div>
  );
}
