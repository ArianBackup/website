'use client';

/* ---------------------------------------------------------------------------
 * app-header.tsx — the chrome you look at more than anything else here.
 *
 * Three bands inside one panel:
 *   1. identity — mark, greeting, today's date
 *   2. vitals   — today's completion ring, two micro-stats, the live clock,
 *                 then the two controls (theme, command palette)
 *   3. the view switcher — a segmented control with a shared-element pill
 *
 * The greeting, the date and the stats are all read live: the greeting off a
 * shared 60-second tick, the date off the provider's live `today`. Leave the tab
 * open past midnight and the header re-greets and re-dates itself without a
 * reload — which is the whole point of the day rolling over on the clock.
 *
 * ---------------------------------------------------------------------------
 * BALANCING THE RIGHT-HAND CLUSTER
 *
 * It carries five things now, so it is split into two groups either side of a
 * hairline — READOUTS (ring, micro-stats, clock) and CONTROLS (theme, search) —
 * and sheds the readouts as the viewport narrows:
 *
 *   < sm   ring + controls only
 *   ≥ sm   the clock pill and the divider appear
 *   ≥ lg   the two micro-stats and the ⌘K hint appear
 *
 * The theme toggle never hides: it is the one control with no other entry point.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  BarChart3,
  CalendarRange,
  Compass,
  Dumbbell,
  Inbox,
  ListChecks,
  NotebookPen,
  type LucideIcon,
  Repeat,
  Search,
  Redo2,
  Undo2,
  Sun,
  Target,
  UtensilsCrossed,
} from 'lucide-react';

import { formatKey } from '../lib/dates';
import { dayProgress, habitStreak, tasksForDay } from '../lib/derive';
import { useAssistant } from '../lib/store';
import { isClockPlaceholder, useNow } from '../lib/use-now';
import { VIEW_IDS, type ViewId } from '../lib/types';
import { LiveClock } from './shared/live-clock';
import { ProgressRing } from './shared/progress-ring';
import { StreakChip } from './shared/streak-chip';
import { ThemeToggle } from './shared/theme-toggle';

export interface AssistantHeaderProps {
  view: ViewId;
  onViewChange: (v: ViewId) => void;
  onOpenPalette: () => void;
}

export interface ViewMeta {
  id: ViewId;
  label: string;
  icon: LucideIcon;
}

/* Ordered the way the day is actually worked, not by scope: what is in front of
 * you, then the week around it, then the two surfaces you clear things through,
 * then the standing commitments — habits, training, food — and the long view
 * last.
 *
 * MUST stay in VIEW_IDS order: the 1–9 hotkeys and the arrow keys below both
 * index between the two lists. See the note on VIEW_IDS in lib/types.ts. */
export const VIEW_META: ViewMeta[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'week', label: 'Week', icon: CalendarRange },
  { id: 'review', label: 'Review', icon: NotebookPen },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'habits', label: 'Habits', icon: Repeat },
  { id: 'workouts', label: 'Train', icon: Dumbbell },
  { id: 'food', label: 'Food', icon: UtensilsCrossed },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
];

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * A greeting that knows what time it is.
 *
 * `now` is null only while the shared clock has not started — a state this
 * header never actually renders in (it mounts after hydration), but the neutral
 * stem keeps it honest rather than guessing an hour.
 */
function greetingFor(now: Date | null, name: string): string {
  let stem = 'Welcome back';

  if (now !== null) {
    const hour = now.getHours();
    stem =
      hour < 5
        ? 'Still up'
        : hour < 12
          ? 'Good morning'
          : hour < 17
            ? 'Good afternoon'
            : hour < 22
              ? 'Good evening'
              : 'Winding down';
  }

  return name ? `${stem}, ${name}` : stem;
}

export function AssistantHeader({
  view,
  onViewChange,
  onOpenPalette,
}: AssistantHeaderProps): JSX.Element {
  const { data, today, canUndo, canRedo, actions } = useAssistant();

  /* Undo lives in the header because it belongs to the whole portal, not to
   * whichever view happens to be open — the change being walked back may have
   * happened on a different tab of the app entirely. */
  const handleUndo = useCallback((): void => {
    if (actions.undo()) toast.success('Change undone');
  }, [actions]);

  const handleRedo = useCallback((): void => {
    if (actions.redo()) toast.success('Change redone');
  }, [actions]);
  const reduce = useReducedMotion();

  /* One shared minute tick for the greeting — the same clock the compact
   * <LiveClock/> below subscribes to, so they cost a single timer between them
   * and can never disagree about the hour. The DATE comes from the provider's
   * live `today`, which flips at local midnight. */
  const tick = useNow(60_000);
  const clockStarted = !isClockPlaceholder(tick);

  const greeting = greetingFor(clockStarted ? tick : null, data.settings.userName.trim());
  const longDate = formatKey(today, 'EEEE d MMMM');

  const vitals = useMemo(() => {
    const progress = dayProgress(data, today);
    const remaining = tasksForDay(data, today).filter((t) => t.completedAt === null).length;
    const streak = data.habits.reduce((best, habit) => {
      if (habit.archivedAt) return best;
      const { current } = habitStreak(data, habit.id, today);
      return current > best ? current : best;
    }, 0);
    return { ratio: progress.ratio, done: progress.done, total: progress.total, remaining, streak };
  }, [data, today]);

  /* ⌘ on Apple hardware, Ctrl everywhere else. Resolved after mount so the
   * first paint never has to guess. */
  const [modKey, setModKey] = useState('⌘');
  useEffect(() => {
    const ua = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
    if (!/Mac|iPhone|iPad|iPod/i.test(ua)) setModKey('Ctrl ');
  }, []);

  /* ---- segmented control: arrow-key navigation ---- */
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const onSegKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;

    const count = VIEW_META.length;
    const current = Math.max(0, VIEW_IDS.indexOf(view));
    const next =
      key === 'ArrowLeft'
        ? (current - 1 + count) % count
        : key === 'ArrowRight'
          ? (current + 1) % count
          : key === 'Home'
            ? 0
            : count - 1;

    const target = VIEW_META[next];
    if (!target) return;
    event.preventDefault();
    onViewChange(target.id);
    buttonsRef.current[next]?.focus();
  };

  /* Keep the selected tab in the window.
   *
   * Nine tabs are ~432px of track in ~324px of window on a phone, so three of
   * them are always off the right edge. Selecting one by tapping is fine — you
   * could see it — but the view also changes from the 1-9 hotkeys, the command
   * palette and a `#hash` on load, and any of those could leave the pill
   * rendered somewhere off-screen with the header showing no active section at
   * all. `block: 'nearest'` so it never scrolls the page vertically to do it. */
  useEffect(() => {
    buttonsRef.current[VIEW_IDS.indexOf(view)]?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [view, reduce]);

  const pillTransition = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 380, damping: 32 } as const);

  return (
    <motion.header
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: HOUSE_EASE }}
      className="pa-panel p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-5">
        {/* ---- identity ---- */}
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="pa-chip-solid size-11 shrink-0 rounded-[1rem]">
            <Compass className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="pa-eyebrow">Personal HQ</p>
            <h1 className="mt-1 text-[21px] font-semibold leading-tight tracking-tight text-[color:var(--pa-navy)] [overflow-wrap:anywhere] sm:truncate sm:text-[26px] md:text-[30px]">
              {greeting}
            </h1>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--pa-faint)]">{longDate}</p>
          </div>
        </div>

        {/* ---- vitals + controls ----
            Deliberately NOT wrapping: the outer row wraps the whole cluster
            under the identity block instead, so the hairline can never end up
            dangling at the end of a broken line. Narrowing sheds parts of it
            (see the header note) rather than reflowing it. */}
        <div className="flex items-center justify-end gap-3 max-sm:flex-wrap sm:gap-4">
          {/* readouts */}
          <div className="flex items-center gap-3 sm:gap-4">
            <ProgressRing value={vitals.ratio} size={46} stroke={4} className="shrink-0" />

            <div className="hidden flex-col gap-1.5 lg:flex">
              <div className="flex items-center gap-2">
                <span className="pa-chip size-[22px] rounded-[0.55rem]">
                  <ListChecks className="size-3.5" />
                </span>
                <p className="text-[12.5px] text-[color:var(--pa-muted)]">
                  <span className="font-medium tabular-nums text-[color:var(--pa-navy)]">
                    {vitals.remaining}
                  </span>{' '}
                  {vitals.remaining === 1 ? 'task left today' : 'tasks left today'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StreakChip count={vitals.streak} />
                <p className="text-[12.5px] text-[color:var(--pa-muted)]">current best</p>
              </div>
            </div>

            {/* The clock gets its own tile so it reads as a considered piece of
                chrome rather than loose text between two controls. */}
            <span className="pa-tile hidden h-9 shrink-0 items-center px-3 sm:inline-flex">
              <LiveClock variant="compact" />
            </span>
          </div>

          <span aria-hidden className="hidden h-9 w-px bg-[color:var(--pa-line)] sm:block" />

          {/* controls */}
          <div className="flex items-center gap-2">
            {/* Back and forward, as a pair: an undo with no redo beside it makes
                walking back feel one-way, which is exactly when people stop
                using it. Both keep their box when disabled so the row cannot
                reflow as the stacks fill and empty. */}
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              data-tip={canUndo ? 'Undo last change' : 'Nothing to undo'}
              data-tip-key={canUndo ? `${modKey}Z` : undefined}
              aria-label={canUndo ? 'Undo last change' : 'Nothing to undo'}
              className={clsx(
                'pa-icon-btn pa-focus size-9 shrink-0',
                !canUndo && 'cursor-not-allowed opacity-35 hover:bg-transparent',
              )}
            >
              <Undo2 className="size-4" strokeWidth={1.9} aria-hidden />
            </button>

            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              data-tip={canRedo ? 'Redo last change' : 'Nothing to redo'}
              data-tip-key={canRedo ? `Shift ${modKey}Z` : undefined}
              aria-label={canRedo ? 'Redo last change' : 'Nothing to redo'}
              className={clsx(
                'pa-icon-btn pa-focus size-9 shrink-0',
                !canRedo && 'cursor-not-allowed opacity-35 hover:bg-transparent',
              )}
            >
              <Redo2 className="size-4" strokeWidth={1.9} aria-hidden />
            </button>

            <ThemeToggle />

            <button
              type="button"
              onClick={onOpenPalette}
              className="pa-cta pa-focus h-9 shrink-0 px-3 text-[13px] sm:px-3.5"
              aria-label="Search and run commands"
            >
              <Search className="size-4" strokeWidth={1.75} />
              <span className="hidden md:inline">Search</span>
              <kbd className="ml-0.5 hidden rounded-[0.4rem] border border-[color:var(--pa-line)] bg-[color:var(--pa-tile)] px-1.5 py-px font-sans text-[10.5px] font-medium tracking-tight text-[color:var(--pa-faint)] lg:inline-block">
                {modKey}K
              </kbd>
            </button>
          </div>
        </div>
      </div>

      {/* ---- view switcher ---- */}
      {/* Nine tabs in ~324px of window. The strip already scrolled; what it
          lacked was any way to know that. `snap-center` plus the scroll-into-view
          effect above keeps the active tab centred — arriving on #insights from a
          hash or a hotkey used to leave the selected pill off-screen entirely —
          `data-fade` shows the cut edge, and `overscroll-behavior-x` (kit) stops
          a swipe past the end handing off to Safari's back gesture. */}
      <div
        className="pa-scroll-x -mx-1 mt-5 snap-x snap-mandatory scroll-px-1 px-1 pb-1"
        data-fade="true"
      >
        <div
          role="group"
          aria-label="Assistant sections"
          onKeyDown={onSegKeyDown}
          className="pa-seg"
        >
          {VIEW_META.map((item, index) => {
            const active = item.id === view;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  buttonsRef.current[index] = node;
                }}
                type="button"
                onClick={() => onViewChange(item.id)}
                data-active={active}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className="pa-seg-btn pa-focus snap-center"
              >
                {active ? (
                  <motion.span
                    layoutId="pa-view-pill"
                    className="pa-seg-pill"
                    transition={pillTransition}
                  />
                ) : null}
                <Icon className="relative z-[1] size-4" strokeWidth={1.75} />
                <span className={clsx('relative z-[1]', active ? 'inline' : 'hidden sm:inline')}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </motion.header>
  );
}
