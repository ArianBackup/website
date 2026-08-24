'use client';

/* ---------------------------------------------------------------------------
 * assistant-app.tsx — the shell.
 *
 * Owns three things and nothing else:
 *   1. the store — every surface below reads from one <AssistantProvider>
 *   2. the active view, mirrored into `location.hash` so a section is linkable
 *      and the back button behaves
 *   3. the three shell states — hydrating, first run, and the real thing
 *
 * The provider cannot consume its own context, so all of the work happens in
 * <AssistantWorkspace>, one level down.
 * ------------------------------------------------------------------------- */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  BarChart3,
  ChevronRight,
  Compass,
  Flame,
  Sparkles,
  Target,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { GlassButton, GLASS_BOX } from '@/components/ui/glass-button';

import { AssistantProvider, useAssistant } from '../lib/store';
import { useHotkeys } from '../lib/use-hotkeys';
import { VIEW_IDS, type ViewId } from '../lib/types';

import { AssistantHeader } from './app-header';
import { BriefHeader } from './brief-header';
import { QuickAdd } from './quick-add';
import { CommandPalette } from './shared/command-palette';
import { TooltipLayer } from './shared/tooltip';
import { FoodView } from './views/food-view';
import { GoalsView } from './views/goals-view';
import { HabitsView } from './views/habits-view';
import { InboxView } from './views/inbox-view';
import { InsightsView } from './views/insights-view';
import { ReviewView } from './views/review-view';
import { TodayView } from './views/today-view';
import { WeekView } from './views/week-view';
import { WorkoutsView } from './views/workouts-view';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

const VIEWS: Record<ViewId, ComponentType> = {
  today: TodayView,
  week: WeekView,
  review: ReviewView,
  inbox: InboxView,
  habits: HabitsView,
  workouts: WorkoutsView,
  food: FoodView,
  goals: GoalsView,
  insights: InsightsView,
};

/** The five buckets a life divides into cleanly enough to start from. */
const DEFAULT_AREAS: { name: string; icon: string; color: string }[] = [
  { name: 'Health & Fitness', icon: 'Dumbbell', color: '#0f9d6e' },
  { name: 'Career & Craft', icon: 'Briefcase', color: '#0099ff' },
  { name: 'Wealth', icon: 'Wallet', color: '#b4761f' },
  { name: 'Relationships', icon: 'Heart', color: '#c9564f' },
  { name: 'Mind & Growth', icon: 'Brain', color: '#7c5cd6' },
];

const CONTAINER = 'mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9';

/* -------------------------------------------------------------------------
 * Hash routing
 * ---------------------------------------------------------------------- */

function isViewId(value: string): value is ViewId {
  return (VIEW_IDS as string[]).includes(value);
}

/** Never called during render — `location` must not decide the first paint. */
function readHash(): ViewId | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  return isViewId(raw) ? raw : null;
}

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

export function AssistantApp(): JSX.Element {
  return (
    <AssistantProvider>
      <AssistantWorkspace />
      {/* Outside the workspace's three shell states and outside the view
          switcher, because a tooltip must survive the thing under it
          re-rendering. It reads no store and renders nothing until something
          with a `data-tip` is hovered — see shared/tooltip.tsx. */}
      <TooltipLayer />
    </AssistantProvider>
  );
}

/* -------------------------------------------------------------------------
 * Workspace
 * ---------------------------------------------------------------------- */

function AssistantWorkspace(): JSX.Element {
  /* `today` is the provider's LIVE day: it flips at local midnight (and on the
   * first focus after a sleep), which re-renders every view below with the new
   * date rather than stranding the tab on yesterday. */
  const { data, hydrated, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [view, setView] = useState<ViewId>('today');
  const [paletteOpen, setPaletteOpen] = useState(false);

  /* A document with nothing in it at all, that has never been seeded. */
  const firstRun =
    hydrated &&
    data.settings.seededAt === null &&
    data.areas.length === 0 &&
    data.goals.length === 0 &&
    data.tasks.length === 0 &&
    data.habits.length === 0;

  /* ---- hash ⇄ view ---- */
  useEffect(() => {
    const fromHash = readHash();
    if (fromHash) setView(fromHash);

    const onHashChange = (): void => {
      const next = readHash();
      if (next) setView(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: ViewId): void => {
    setView(next);
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}#${next}`);
  }, []);

  /* While the first-run screen is up there is nowhere to navigate to. */
  const onNavigate = useCallback(
    (next: ViewId): void => {
      if (firstRun) return;
      navigate(next);
    },
    [firstRun, navigate],
  );

  const onPalette = useCallback((): void => {
    if (firstRun) return;
    setPaletteOpen((open) => !open);
  }, [firstRun]);

  const onQuickAdd = useCallback((): void => {
    setPaletteOpen(false);
  }, []);

  /* The same walk-back the header buttons perform, on ⌘Z and Shift+⌘Z. */
  const onUndo = useCallback((): void => {
    if (actions.undo()) toast.success('Change undone');
  }, [actions]);

  const onRedo = useCallback((): void => {
    if (actions.redo()) toast.success('Change redone');
  }, [actions]);

  useHotkeys({ onNavigate, onPalette, onQuickAdd, onUndo, onRedo });

  /* ---- header → brief header ----
   * Watched with an IntersectionObserver rather than a scroll offset: the
   * header's own height changes with the viewport (its right-hand cluster
   * sheds parts of itself as things narrow), so any pixel threshold would be a
   * guess that goes stale. `0.2` hands over while the last fifth of it is still
   * on screen, which is early enough that the two are never both legible. */
  const [headerNode, setHeaderNode] = useState<HTMLDivElement | null>(null);
  const [condensed, setCondensed] = useState(false);

  /* A callback ref, not `useRef`. The first-run screen renders a different tree
   * with no header in it, so an effect with `[]` deps runs once against a null
   * ref and never again — the header appears after the example plan is loaded
   * and nothing is ever observed. Holding the node in state re-runs this the
   * moment it exists. */
  useEffect(() => {
    if (!headerNode || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry !== undefined && !entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(headerNode);
    return () => observer.disconnect();
  }, [headerNode]);

  /* ---- first-run actions ---- */
  const loadExample = useCallback((): void => {
    actions.loadSeed();
    toast.success('Example plan loaded', {
      description: 'Four months of goals, streaks and reviews to explore.',
    });
  }, [actions]);

  /**
   * Restore a backup taken somewhere else.
   *
   * localStorage is scoped to the ORIGIN, so a document built at one domain is
   * simply not there at another — moving the portal between hosts is, as far
   * as the browser is concerned, the same as moving to a new laptop. This is
   * how the document travels: export to JSON on the old origin, restore here.
   *
   * `importJson` validates before it replaces anything, so a wrong or damaged
   * file is refused rather than half-loaded over the top of what is here.
   */
  const restoreBackup = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      // Cleared straight away so re-picking the same file still fires a change.
      event.target.value = '';
      if (!file) return;
      try {
        actions.importJson(await file.text());
        toast.success('Backup restored', { description: file.name });
      } catch (error) {
        toast.error('That file could not be imported', {
          description: error instanceof Error ? error.message : 'Unknown error.',
        });
      }
    },
    [actions],
  );

  const startFresh = useCallback((): void => {
    for (const area of DEFAULT_AREAS) actions.addArea(area);
    actions.updateSettings({ seededAt: new Date().toISOString() });
    toast.success('Your system is ready', {
      description: 'Five life areas to hang your first goal on.',
    });
  }, [actions]);

  /* ---- state 1: hydrating ---- */
  if (!hydrated) return <ShellSkeleton />;

  /* ---- state 2: nothing here yet ---- */
  if (firstRun) {
    return (
      <FirstRunScreen
        onLoadExample={loadExample}
        onStartFresh={startFresh}
        onRestore={restoreBackup}
      />
    );
  }

  /* ---- state 3: the portal ---- */
  const ActiveView = VIEWS[view];

  return (
    <div className={CONTAINER}>
      <div ref={setHeaderNode}>
        <AssistantHeader view={view} onViewChange={navigate} onOpenPalette={onPalette} />
      </div>

      {/* Takes over once the header above has scrolled away — see brief-header. */}
      <BriefHeader open={condensed} />

      <QuickAdd defaultDay={today} className="mt-4 sm:mt-5" />

      <div className="mt-5 sm:mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: 0.25, ease: HOUSE_EASE }}
          >
            <ActiveView />
          </motion.div>
        </AnimatePresence>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={navigate} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Skeleton — the shape of the page, before the page.
 * ---------------------------------------------------------------------- */

interface SkelProps {
  className?: string;
  delay?: number;
}

function Skel({ className, delay = 0 }: SkelProps): JSX.Element {
  return (
    // `--pa-line` rather than a literal navy wash: in dark mode it resolves to a
    // low-alpha white lift, so the skeleton reads as absent content on either
    // stage instead of a navy smudge on a near-black one.
    <span
      className={clsx('block animate-pulse bg-[color:var(--pa-line)]', className)}
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

function ShellSkeleton(): JSX.Element {
  return (
    <div className={CONTAINER}>
      <span className="sr-only" role="status">
        Loading your system
      </span>

      <div aria-hidden>
        {/* header */}
        <div className="pa-panel pa-sheen relative overflow-hidden p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-5">
            <div className="flex items-center gap-3.5">
              <Skel className="size-11 rounded-[1rem]" />
              <div className="space-y-2.5 py-0.5">
                <Skel className="h-2.5 w-24 rounded-full" delay={60} />
                <Skel className="h-[18px] w-56 rounded-full" delay={120} />
                <Skel className="h-2.5 w-32 rounded-full" delay={180} />
              </div>
            </div>
            {/* Mirrors the real cluster's shed order: stats at lg, clock at sm,
                the two controls always. */}
            <div className="flex items-center gap-3 sm:gap-4">
              <Skel className="size-[46px] rounded-full" delay={90} />
              <Skel className="hidden h-9 w-36 rounded-xl lg:block" delay={150} />
              <Skel className="hidden h-9 w-[76px] rounded-[1.15rem] sm:block" delay={180} />
              <Skel className="h-9 w-[72px] rounded-full" delay={210} />
              <Skel className="h-9 w-24 rounded-full" delay={240} />
            </div>
          </div>
          <Skel className="mt-5 h-[42px] w-full max-w-[560px] rounded-full" delay={240} />
        </div>

        {/* capture bar */}
        <div className="pa-capture mt-4 flex items-center gap-2.5 p-2 sm:mt-5">
          <Skel className="size-10 rounded-[0.85rem]" />
          <Skel className="h-3 w-44 rounded-full" delay={80} />
        </div>

        {/* body */}
        <div className="mt-5 grid gap-4 sm:mt-6 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
          <div className="pa-panel p-5 sm:p-6">
            <Skel className="h-2.5 w-20 rounded-full" />
            <Skel className="mt-3 h-4 w-40 rounded-full" delay={60} />
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skel key={i} className="h-[92px] rounded-[1.15rem]" delay={120 + i * 70} />
              ))}
            </div>
            <div className="mt-5 space-y-2.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skel key={i} className="h-[52px] rounded-[1rem]" delay={300 + i * 60} />
              ))}
            </div>
          </div>

          <div className="pa-panel p-5 sm:p-6">
            <Skel className="h-2.5 w-16 rounded-full" delay={40} />
            <Skel className="mt-3 h-4 w-32 rounded-full" delay={100} />
            <Skel className="mt-5 h-[120px] rounded-[1.15rem]" delay={160} />
            <div className="mt-4 space-y-2.5">
              {[0, 1, 2].map((i) => (
                <Skel key={i} className="h-[44px] rounded-[1rem]" delay={220 + i * 70} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * First run — the only screen that gets to be a sales pitch.
 * ---------------------------------------------------------------------- */

interface FirstRunScreenProps {
  onLoadExample: () => void;
  onStartFresh: () => void;
  onRestore: (event: ChangeEvent<HTMLInputElement>) => void;
}

interface FeatureCard {
  icon: LucideIcon;
  title: string;
  body: string;
}

const FEATURES: FeatureCard[] = [
  {
    icon: Target,
    title: 'The Big Three',
    body: 'Rank three things each morning. Everything else on the list is a bonus, not a debt.',
  },
  {
    icon: Flame,
    title: 'Streaks that are honest',
    body: 'Habits know their own cadence, so a planned rest day never breaks a run.',
  },
  {
    icon: BarChart3,
    title: 'A weekly verdict',
    body: 'Five minutes on Sunday: what moved, what stalled, and the one focus for next week.',
  },
];

const CASCADE = ['Vision', 'Year', 'Quarter', 'Milestone', 'Today'];

function FirstRunScreen({
  onLoadExample,
  onStartFresh,
  onRestore,
}: FirstRunScreenProps): JSX.Element {
  const reduce = useReducedMotion();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const rise = (index: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.35,
      ease: HOUSE_EASE,
      delay: reduce ? 0 : Math.min(index * 0.06, 0.3),
    },
  });

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
      <motion.section
        {...rise(0)}
        className="pa-panel pa-sheen relative overflow-hidden p-7 sm:p-10 lg:p-12"
      >
        {/* Token-driven so the corner glow brightens with the accent in dark
            mode instead of staying a fixed light-theme azure. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, var(--pa-accent-bg-strong), var(--pa-accent-glow) 58%, transparent 78%)',
          }}
        />

        <span className="pa-chip-solid size-12 rounded-[1.05rem]">
          <Compass className="size-6" strokeWidth={1.75} />
        </span>

        <p className="pa-eyebrow mt-6">Personal HQ</p>
        <h1 className="mt-2 max-w-[20ch] text-[30px] font-semibold leading-[1.08] tracking-tight text-[color:var(--pa-navy)] sm:text-[38px]">
          A system that runs from your vision down to this afternoon.
        </h1>
        <p className="mt-4 max-w-[58ch] text-[14px] leading-relaxed text-[color:var(--pa-muted)]">
          Life areas hold your goals. Goals break into milestones. Milestones become the three
          things you actually do today — and every task can trace its way back up.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {CASCADE.map((step, index) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="pa-badge" data-tone={index === CASCADE.length - 1 ? 'azure' : undefined}>
                {step}
              </span>
              {index < CASCADE.length - 1 ? (
                <ChevronRight
                  className="size-3.5 text-[color:var(--pa-faint)]"
                  strokeWidth={1.75}
                  aria-hidden
                />
              ) : null}
            </span>
          ))}
        </div>

        {/* One primary action, in the shared "Haze light" glass; everything
            secondary stays a frosted .pa-cta pill. */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <GlassButton
            className="glass-button--haze-light"
            size="none"
            buttonClassName={GLASS_BOX.h11.button}
            contentClassName={GLASS_BOX.h11.content}
            type="button"
            onClick={onLoadExample}
          >
            <span className="inline-flex items-center gap-2">
              <Sparkles className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Load example plan
            </span>
          </GlassButton>

          <button
            type="button"
            onClick={onStartFresh}
            className="pa-cta pa-focus h-11 px-5 text-[14px]"
          >
            Start fresh
          </button>

          {/* The third door, and the reason it has to be HERE rather than only
              in the command palette: the palette is mounted below this screen,
              so on a browser that has never held a document there is no way to
              reach it. Arriving on a new machine — or a new domain, which is
              the same thing to localStorage — holding a backup and having
              nowhere to put it is exactly the moment this is for. */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="pa-cta pa-focus h-11 px-5 text-[14px]"
          >
            <span className="inline-flex items-center gap-2">
              <Upload className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Restore a backup
            </span>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onRestore}
          />
        </div>

        <p className="mt-4 text-[11.5px] text-[color:var(--pa-faint)]">
          Everything stays in this browser. Nothing is uploaded, nothing is shared.
        </p>
      </motion.section>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <motion.article
              key={feature.title}
              {...rise(index + 1)}
              className="pa-card pa-card-flat p-5"
            >
              <span className="pa-chip size-9 rounded-[0.8rem]">
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
              <h2 className="mt-3.5 text-[15px] font-medium tracking-tight text-[color:var(--pa-navy)]">
                {feature.title}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
                {feature.body}
              </p>
            </motion.article>
          );
        })}
      </div>
    </div>
  );
}
