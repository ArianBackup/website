'use client';

/* ---------------------------------------------------------------------------
 * goal-detail-dialog.tsx — one goal, opened all the way up.
 *
 * Two dialogs live here:
 *
 *   <GoalDetailDialog>    the reading surface. Why → progress → milestones →
 *                         linked tasks → the four decisions you can make about
 *                         a goal (achieve, pause, edit, delete).
 *   <GoalComposerDialog>  the writing surface, shared by "New goal" in the
 *                         Goals view and "Edit" in the detail dialog.
 *
 * Radix portals both to <body>, outside `.assistant-shell`, and every `.pa-*`
 * class is scoped under it — hence the shell wrapper inside the content. The
 * dialog is centred with a TRANSFORM, so nothing in here may rely on
 * backdrop-filter; every surface is a flat token fill instead.
 *
 * Both portals are marked `pa-portal`, which strips the host kit's own frosted
 * box (fill, border, shadow, `rounded-lg`) off the Radix container — that stray
 * box used to peek out from behind our 1.5rem sheet as a second, squarer
 * corner. With it gone the inner `.pa-sheet` owns every pixel, and its
 * `overflow-hidden` keeps the sticky header and footer inside its radius.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import {
  ArrowUp,
  CalendarDays,
  Check,
  CornerLeftUp,
  Flag,
  ListChecks,
  Pause,
  PencilLine,
  Play,
  Plus,
  Quote,
  RotateCcw,
  Target,
  Trash2,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
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
import { daysBetween, relativeDayLabel } from '../../lib/dates';
import { goalMilestones, goalProgress, goalTasks } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type {
  DayKey,
  Goal,
  GoalHorizon,
  GoalProgress,
  ID,
  LifeArea,
  Milestone,
  Task,
} from '../../lib/types';
import { GoalPicker } from '../shared/goal-picker';
import { Meter } from '../shared/meter';
import { TaskRow } from '../shared/task-row';

/* -------------------------------------------------------------------------
 * Shared vocabulary
 * ---------------------------------------------------------------------- */

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

export const HORIZON_LABEL: Record<GoalHorizon, string> = {
  vision: 'Vision',
  year: 'This year',
  quarter: 'This quarter',
};

const HORIZON_ORDER: GoalHorizon[] = ['vision', 'year', 'quarter'];

const HORIZON_HINT: Record<GoalHorizon, string> = {
  vision: 'Three to ten years out — who you are becoming.',
  year: 'A twelve-month outcome you could point at.',
  quarter: 'Ninety days. The level that actually drives your weeks.',
};

/** Neutralises `.assistant-shell`'s page geometry inside a portal. */
const PORTAL_SHELL = { minHeight: 0, overflowX: 'visible' } as const;

/* The one rounded sheet each dialog is made of. `.pa-sheet` carries the radius,
 * the near-opaque `--pa-solid` fill, the lit edge and the layered elevation, so
 * nothing here re-states them; `overflow-hidden` is what stops the header and
 * footer squaring off the corners they sit flush against. */
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

/* The glass pill carries no focus style of its own, and its look is built out of
 * five stacked box-shadows — so the keyboard ring has to be an OUTLINE, which
 * follows the pill's radius without touching any of that. */
export const GLASS_FOCUS = clsx(
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-[color:var(--pa-azure)]',
);

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

/* A status hairline at reduced alpha. `--pa-red` is a different colour in each
 * theme, so the edge is mixed from the token rather than written out. */
const RED_EDGE = 'color-mix(in srgb, var(--pa-red) 45%, transparent)';

const FIELD_LABEL =
  'mb-2 block text-[11px] font-medium uppercase tracking-[0.11em] text-[color:var(--pa-faint)]';

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

/** `'12 days left'` / `'Due today'` / `'9 days overdue'`. */
function remainingLabel(targetDate: DayKey, refDay: DayKey): string {
  const delta = daysBetween(refDay, targetDate);
  if (delta === 0) return 'Due today';
  if (delta > 0) return `${delta} ${delta === 1 ? 'day' : 'days'} left`;
  const over = Math.abs(delta);
  return `${over} ${over === 1 ? 'day' : 'days'} overdue`;
}

/** Says what the number is actually made of, rather than implying precision. */
function basisLabel(progress: GoalProgress): string {
  if (progress.basis === 'milestones') {
    return `${progress.done} of ${progress.total} ${
      progress.total === 1 ? 'milestone' : 'milestones'
    }`;
  }
  if (progress.basis === 'tasks') {
    return `${progress.done} of ${progress.total} linked ${
      progress.total === 1 ? 'task' : 'tasks'
    }`;
  }
  if (progress.basis === 'goals') {
    return `Rolled up from ${progress.total} ${
      progress.total === 1 ? 'goal' : 'goals'
    } beneath it`;
  }
  return 'No milestones yet';
}

/* -------------------------------------------------------------------------
 * Section shell — an eyebrow, a count and a hairline, used three times
 * ---------------------------------------------------------------------- */

interface PanelSectionProps {
  eyebrow: string;
  count?: number;
  icon: LucideIcon;
  children: ReactNode;
  delay: number;
  reduce: boolean;
}

function PanelSection({
  eyebrow,
  count,
  icon: Icon,
  children,
  delay,
  reduce,
}: PanelSectionProps): JSX.Element {
  return (
    <motion.section
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : delay }}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="pa-chip size-6 shrink-0 rounded-[0.5rem]" aria-hidden="true">
          <Icon className="size-3.5" strokeWidth={2} />
        </span>
        <h3 className="pa-eyebrow leading-none">{eyebrow}</h3>
        {typeof count === 'number' ? (
          <span className="text-[11.5px] tabular-nums leading-none text-[color:var(--pa-faint)]">
            {count}
          </span>
        ) : null}
        <span className="pa-divider flex-1" aria-hidden="true" />
      </div>
      {children}
    </motion.section>
  );
}

/* -------------------------------------------------------------------------
 * Inline add — a row that behaves like a list item and stays focused
 * ---------------------------------------------------------------------- */

interface InlineAddProps {
  placeholder: string;
  label: string;
  onAdd: (value: string) => void;
  icon?: LucideIcon;
}

function InlineAdd({ placeholder, label, onAdd, icon: Icon = Plus }: InlineAddProps): JSX.Element {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = value.trim();
    if (text.length === 0) return;
    onAdd(text);
    setValue('');
    // Rapid entry: the field keeps the caret so a list can be typed in one go.
    inputRef.current?.focus();
  };

  const empty = value.trim().length === 0;

  return (
    <form
      onSubmit={submit}
      className={clsx(
        'pa-row flex items-center gap-2.5 px-2.5 py-1.5',
        'focus-within:border-[color:var(--pa-accent-border)] focus-within:bg-[color:var(--pa-row-hover)]',
      )}
    >
      <span className="pa-chip size-7 shrink-0 rounded-[0.6rem]" aria-hidden="true">
        <Icon className="size-3.5" strokeWidth={2} />
      </span>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => setValue(capitaliseOnType(event))}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className={clsx(
          'min-w-0 flex-1 border-0 bg-transparent py-1.5 text-[13.5px] outline-none',
          'text-[color:var(--pa-navy)] placeholder:text-[color:var(--pa-faint)]',
        )}
      />

      {/* Deliberately NOT the haze-light glass pill: a dialog gets one primary
          action, and in here that is "Mark achieved" / "Create goal". This is a
          quiet azure affordance that only earns attention once you have typed. */}
      <button
        type="submit"
        disabled={empty}
        aria-label={label}
        className={clsx(
          'pa-cta size-7 shrink-0 p-0',
          'disabled:opacity-30 disabled:shadow-none',
          PILL_FOCUS,
        )}
      >
        <ArrowUp className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------
 * Milestone row
 * ---------------------------------------------------------------------- */

interface MilestoneRowProps {
  milestone: Milestone;
  index: number;
  refDay: DayKey;
}

function MilestoneRow({ milestone, index, refDay }: MilestoneRowProps): JSX.Element {
  const { actions } = useAssistant();
  const reduce = useReducedMotion();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(milestone.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Set by Escape so the blur that follows discards rather than saving. */
  const abortRef = useRef(false);

  const done = milestone.completedAt !== null;

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const commit = useCallback((): void => {
    if (abortRef.current) {
      abortRef.current = false;
      setEditing(false);
      return;
    }
    setEditing(false);
    const next = draft.trim();
    if (next.length === 0 || next === milestone.title) return;
    actions.updateMilestone(milestone.id, { title: next });
  }, [actions, draft, milestone.id, milestone.title]);

  /* The feedback is the toast plus every meter above it moving at once — the
   * goal's percentage, its basis line and the life-area strip behind the
   * dialog all redraw off this one tick. */
  const toggle = useCallback((): void => {
    const becameComplete = actions.toggleMilestone(milestone.id);
    if (becameComplete) {
      toast.success('Milestone complete', { description: milestone.title });
    }
  }, [actions, milestone.id, milestone.title]);

  const tone = dateTone(milestone.targetDate, refDay, done);

  return (
    <motion.div
      layout={reduce ? false : 'position'}
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.18 } }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      className="pa-row pa-row-hover group flex min-h-[48px] w-full items-center gap-3 px-3 py-2"
      data-done={done ? 'true' : 'false'}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={
          done ? `Reopen milestone "${milestone.title}"` : `Complete milestone "${milestone.title}"`
        }
        data-tip={done ? 'Reopen' : 'Complete'}
        onClick={toggle}
        className="pa-check"
        data-checked={done ? 'true' : 'false'}
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

      <span
        className="w-5 shrink-0 text-right text-[11px] tabular-nums leading-none text-[color:var(--pa-faint)]"
        aria-hidden="true"
      >
        {String(index + 1).padStart(2, '0')}
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(capitaliseOnType(event))}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                abortRef.current = true;
                setEditing(false);
              }
            }}
            aria-label={`Rename milestone "${milestone.title}"`}
            className={clsx(
              '-mx-1 w-full min-w-0 rounded-md border-0 bg-[color:var(--pa-accent-bg)] px-1 py-0.5',
              'text-[13.5px] text-[color:var(--pa-navy)] outline-none ring-0',
            )}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              abortRef.current = false;
              setDraft(milestone.title);
              setEditing(true);
            }}
            data-tip="Click to rename"
            className={clsx(
              '-mx-1 block min-w-0 max-w-full truncate rounded-md px-1 py-0.5 text-left text-[13.5px]',
              PILL_FOCUS,
              done ? 'pa-struck' : 'text-[color:var(--pa-navy)]',
            )}
          >
            {milestone.title}
          </button>
        )}
      </div>

      {milestone.targetDate !== null ? (
        <span className="pa-badge shrink-0" data-tone={tone}>
          <CalendarDays className="size-3 shrink-0" aria-hidden="true" />
          {relativeDayLabel(milestone.targetDate, refDay)}
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => {
          actions.deleteMilestone(milestone.id);
          toast.success('Milestone removed', { description: milestone.title });
        }}
        aria-label={`Delete milestone "${milestone.title}"`}
        data-tip="Delete milestone"
        data-danger="true"
        className={clsx(
          'pa-icon-btn pa-focus size-7 shrink-0 opacity-0 transition-opacity duration-200 [@media(pointer:coarse)]:opacity-100',
          'group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
        )}
      >
        <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
 * The detail dialog
 * ---------------------------------------------------------------------- */

export interface GoalDetailDialogProps {
  /** The goal to show. `null` closes the dialog. */
  goalId: ID | null;
  onOpenChange: (open: boolean) => void;
}

export function GoalDetailDialog({ goalId, onOpenChange }: GoalDetailDialogProps): JSX.Element {
  /* `today` comes from the store rather than being computed here: it is live,
   * so a dialog left open across midnight re-dates its own countdowns. */
  const { data, actions, today } = useAssistant();
  const reduce = useReducedMotion();

  /* Radix keeps the content mounted through its close animation, so the id is
   * remembered after the caller has cleared it — otherwise the panel would empty
   * out in full view on the way down. Reading `goalId` first (rather than waiting
   * for the effect) means the very first frame of an OPEN is already correct. */
  const [lastId, setLastId] = useState<ID | null>(null);
  useEffect(() => {
    if (goalId !== null) setLastId(goalId);
  }, [goalId]);
  const retainedId = goalId ?? lastId;

  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const open = goalId !== null;

  /* Every transient piece of state belongs to one visit. */
  useEffect(() => {
    if (open) return;
    setConfirmingDelete(false);
    setShowDone(false);
    setEditorOpen(false);
  }, [open]);

  /* A delete that is armed and then ignored disarms itself. */
  useEffect(() => {
    if (!confirmingDelete) return undefined;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  const goal = useMemo<Goal | null>(
    () => (retainedId === null ? null : (data.goals.find((g) => g.id === retainedId) ?? null)),
    [data.goals, retainedId],
  );

  const detail = useMemo(() => {
    if (!goal) return null;
    const area: LifeArea | null =
      goal.areaId === null ? null : (data.areas.find((a) => a.id === goal.areaId) ?? null);
    const parent: Goal | null =
      goal.parentGoalId === null
        ? null
        : (data.goals.find((g) => g.id === goal.parentGoalId) ?? null);

    const milestones = goalMilestones(data, goal.id);
    const tasks = goalTasks(data, goal.id);
    const progress = goalProgress(data, goal.id);
    const achieved = goal.status === 'achieved';

    return {
      area,
      parent,
      milestones,
      openTasks: tasks.filter((t: Task) => t.completedAt === null),
      doneTasks: tasks.filter((t: Task) => t.completedAt !== null),
      progress,
      ratio: achieved ? 1 : progress.ratio,
      achieved,
    };
  }, [data, goal]);

  /* ---- actions ---- */

  const markAchieved = useCallback((): void => {
    if (!goal) return;
    actions.setGoalStatus(goal.id, 'achieved');
    toast.success('Goal achieved', { description: goal.title });
  }, [actions, goal]);

  const setStatus = useCallback(
    (status: 'active' | 'paused'): void => {
      if (!goal) return;
      actions.setGoalStatus(goal.id, status);
      toast.success(status === 'paused' ? 'Goal paused' : 'Goal is live again', {
        description: goal.title,
      });
    },
    [actions, goal],
  );

  const remove = useCallback((): void => {
    if (!goal) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    const { id, title } = goal;
    /* Dismiss first and delete once the panel has gone: removing the record
     * under a dialog that is still fading out would blank it mid-animation. */
    onOpenChange(false);
    window.setTimeout(() => actions.deleteGoal(id), 220);
    toast.success('Goal deleted', { description: `${title} — its tasks were kept and unfiled.` });
  }, [actions, confirmingDelete, goal, onOpenChange]);

  const addMilestone = useCallback(
    (title: string): void => {
      if (!goal) return;
      actions.addMilestone(goal.id, title);
    },
    [actions, goal],
  );

  const addTask = useCallback(
    (title: string): void => {
      if (!goal) return;
      actions.addTask({ title, goalId: goal.id, scheduledFor: today });
      toast.success('Added to today', { description: title });
    },
    [actions, goal, today],
  );

  const rise = (index: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.35,
      ease: HOUSE_EASE,
      delay: reduce ? 0 : Math.min(index * 0.045, 0.3),
    },
  });

  const percent = detail ? Math.round(detail.ratio * 100) : 0;
  const targetTone = goal ? dateTone(goal.targetDate, today, detail?.achieved ?? false) : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          overlayClassName={OVERLAY}
          className={clsx('pa-portal', CONTENT, 'sm:max-w-[740px]')}
        >
          <div className="assistant-shell" style={PORTAL_SHELL}>
            <div className={SURFACE}>
              {goal && detail ? (
                <>
                  {/* ---------------- header ---------------- */}
                  <DialogHeader className="relative shrink-0 gap-0 border-b border-[color:var(--pa-line)] px-5 pb-5 pt-5 sm:px-7 sm:pb-6 sm:pt-6">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-10 -top-16 size-52 rounded-full"
                      style={{
                        background: `radial-gradient(closest-side, ${
                          detail.area ? `${detail.area.color}26` : 'var(--pa-accent-bg-strong)'
                        }, transparent 72%)`,
                      }}
                    />

                    <div className="relative flex items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              background: detail.area ? detail.area.color : 'var(--pa-faint)',
                              boxShadow: detail.area
                                ? `0 0 0 3px ${detail.area.color}1f`
                                : undefined,
                            }}
                          />
                          <span className="truncate text-[12.5px] text-[color:var(--pa-muted)]">
                            {detail.area ? detail.area.name : 'Unfiled'}
                          </span>
                        </span>

                        <span
                          className="pa-badge"
                          data-tone={goal.horizon === 'quarter' ? 'azure' : undefined}
                        >
                          {HORIZON_LABEL[goal.horizon]}
                        </span>

                        {detail.achieved ? (
                          <span className="pa-badge" data-tone="green">
                            <Trophy className="size-3" strokeWidth={2} aria-hidden="true" />
                            Achieved
                          </span>
                        ) : null}

                        {goal.status === 'paused' ? (
                          <span className="pa-badge" data-tone="amber">
                            <Pause className="size-3" strokeWidth={2} aria-hidden="true" />
                            Paused
                          </span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="pa-icon-btn pa-focus -mr-1.5 -mt-1 size-8 shrink-0"
                        aria-label="Close goal"
                        data-tip="Close"
                        data-tip-key="Esc"
                      >
                        <X className="size-4" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    </div>

                    <DialogTitle
                      className={clsx(
                        'relative mt-3 max-w-[30ch] text-[21px] font-semibold leading-[1.18] tracking-tight sm:text-[24px]',
                        'text-[color:var(--pa-navy)]',
                      )}
                    >
                      {goal.title}
                    </DialogTitle>

                    <DialogDescription className="sr-only">
                      {HORIZON_HINT[goal.horizon]} Milestones, linked tasks and progress for this
                      goal.
                    </DialogDescription>

                    {detail.parent ? (
                      <p className="relative mt-2.5 flex items-center gap-1.5 text-[12px] text-[color:var(--pa-faint)]">
                        <CornerLeftUp
                          className="size-3.5 shrink-0"
                          strokeWidth={1.9}
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          Supports{' '}
                          <span className="text-[color:var(--pa-muted)]">
                            {detail.parent.title}
                          </span>
                        </span>
                      </p>
                    ) : null}
                  </DialogHeader>

                  {/* ---------------- body ---------------- */}
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
                    {/* ---- the why ---- */}
                    <motion.div {...rise(0)}>
                      {goal.why.trim().length > 0 ? (
                        <div
                          className="pa-tile relative overflow-hidden p-4 sm:p-5"
                          style={{
                            background: 'var(--pa-accent-bg)',
                            borderColor: 'var(--pa-accent-ring)',
                          }}
                        >
                          <Quote
                            className="pointer-events-none absolute -right-3 -top-2 size-20 text-[color:var(--pa-accent-bg-strong)]"
                            strokeWidth={1.1}
                            aria-hidden="true"
                          />
                          <p className="pa-eyebrow relative leading-none">Why this matters</p>
                          <p className="relative mt-2.5 max-w-[54ch] text-[14px] leading-relaxed text-[color:var(--pa-navy)]">
                            {goal.why}
                          </p>
                        </div>
                      ) : (
                        <div className="pa-drop flex flex-wrap items-center justify-between gap-3 p-4">
                          <p className="text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
                            No <span className="text-[color:var(--pa-navy)]">why</span> yet. A goal
                            without one is the first thing you drop.
                          </p>
                          <button
                            type="button"
                            onClick={() => setEditorOpen(true)}
                            className={QUIET_PILL}
                          >
                            <PencilLine className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                            Write it
                          </button>
                        </div>
                      )}
                    </motion.div>

                    {/* ---- progress ---- */}
                    <motion.div {...rise(1)} className="pa-tile mt-4 p-4 sm:p-5">
                      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                        <div className="min-w-0">
                          <p className="flex items-baseline gap-1">
                            <span className="pa-stat text-[2.4rem] tabular-nums sm:text-[2.75rem]">
                              {percent}
                            </span>
                            <span className="text-[15px] font-medium text-[color:var(--pa-muted)]">
                              %
                            </span>
                          </p>
                          <p className="mt-1 text-[12.5px] text-[color:var(--pa-muted)]">
                            {basisLabel(detail.progress)}
                            {detail.openTasks.length > 0 ? (
                              <span className="text-[color:var(--pa-faint)]">
                                {' '}
                                · {detail.openTasks.length} open{' '}
                                {detail.openTasks.length === 1 ? 'task' : 'tasks'}
                              </span>
                            ) : null}
                          </p>
                        </div>

                        {goal.targetDate !== null ? (
                          <div className="text-right">
                            <p className="flex items-center justify-end gap-1.5 text-[12.5px] text-[color:var(--pa-muted)]">
                              <CalendarDays
                                className="size-3.5 shrink-0"
                                strokeWidth={1.9}
                                aria-hidden="true"
                              />
                              {relativeDayLabel(goal.targetDate, today)}
                            </p>
                            <p className="mt-1">
                              <span className="pa-badge" data-tone={targetTone}>
                                {detail.achieved ? 'Done' : remainingLabel(goal.targetDate, today)}
                              </span>
                            </p>
                          </div>
                        ) : (
                          <p className="text-[12px] text-[color:var(--pa-faint)]">No target date</p>
                        )}
                      </div>

                      <Meter
                        value={detail.ratio}
                        complete={detail.achieved || detail.ratio >= 1}
                        className="mt-4"
                      />
                    </motion.div>

                    {/* ---- milestones ---- */}
                    <div className="mt-7">
                      <PanelSection
                        eyebrow="Milestones"
                        count={detail.milestones.length}
                        icon={Flag}
                        delay={0.09}
                        reduce={Boolean(reduce)}
                      >
                        <div className="pa-well space-y-2 p-2">
                          <AnimatePresence initial={false}>
                            {detail.milestones.map((milestone, index) => (
                              <MilestoneRow
                                key={milestone.id}
                                milestone={milestone}
                                index={index}
                                refDay={today}
                              />
                            ))}
                          </AnimatePresence>

                          {detail.milestones.length === 0 ? (
                            <p className="px-2 py-3 text-[12.5px] leading-relaxed text-[color:var(--pa-faint)]">
                              Break the goal into three to five checkpoints and progress starts
                              telling the truth.
                            </p>
                          ) : null}

                          <InlineAdd
                            icon={Flag}
                            placeholder="Add a milestone…"
                            label="Add milestone"
                            onAdd={addMilestone}
                          />
                        </div>
                      </PanelSection>
                    </div>

                    {/* ---- linked tasks ---- */}
                    <div className="mt-7">
                      <PanelSection
                        eyebrow="Linked tasks"
                        count={detail.openTasks.length + detail.doneTasks.length}
                        icon={ListChecks}
                        delay={0.13}
                        reduce={Boolean(reduce)}
                      >
                        <div className="pa-well space-y-2 p-2">
                          <AnimatePresence initial={false}>
                            {detail.openTasks.map((task, index) => (
                              <TaskRow
                                key={task.id}
                                task={task}
                                index={index}
                                dense
                                showDate
                                showTrace={false}
                              />
                            ))}
                          </AnimatePresence>

                          {detail.openTasks.length === 0 ? (
                            <p className="px-2 py-3 text-[12.5px] leading-relaxed text-[color:var(--pa-faint)]">
                              {detail.doneTasks.length > 0
                                ? 'Nothing open against this goal right now.'
                                : 'Nothing scheduled against this goal yet — name the very next action.'}
                            </p>
                          ) : null}

                          <InlineAdd
                            placeholder="Next action — lands on today…"
                            label="Add task to this goal"
                            onAdd={addTask}
                          />

                          {detail.doneTasks.length > 0 ? (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() => setShowDone((value) => !value)}
                                aria-expanded={showDone}
                                className={clsx(
                                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5',
                                  'text-[12px] font-medium text-[color:var(--pa-faint)]',
                                  'transition-colors duration-150 hover:text-[color:var(--pa-navy)]',
                                  PILL_FOCUS,
                                )}
                              >
                                <Check className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
                                {showDone ? 'Hide' : 'Show'} {detail.doneTasks.length} completed
                              </button>

                              <AnimatePresence initial={false}>
                                {showDone ? (
                                  <motion.div
                                    key="done"
                                    initial={{ opacity: 0, height: reduce ? 'auto' : 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: reduce ? 'auto' : 0 }}
                                    transition={{ duration: 0.25, ease: HOUSE_EASE }}
                                    className="overflow-hidden"
                                  >
                                    <div className="space-y-2 pt-2">
                                      {detail.doneTasks.map((task, index) => (
                                        <TaskRow
                                          key={task.id}
                                          task={task}
                                          index={index}
                                          dense
                                          showDate
                                          showTrace={false}
                                        />
                                      ))}
                                    </div>
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                            </div>
                          ) : null}
                        </div>
                      </PanelSection>
                    </div>
                  </div>

                  {/* ---------------- footer ---------------- */}
                  <div className="shrink-0 border-t border-[color:var(--pa-line)] bg-[color:var(--pa-well)] px-5 py-4 sm:px-7">
                    <div className="flex flex-wrap items-center gap-2">
                      {detail.achieved ? (
                        <button
                          type="button"
                          onClick={() => setStatus('active')}
                          className={QUIET_PILL}
                        >
                          <RotateCcw className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                          Reopen goal
                        </button>
                      ) : (
                        /* The one primary decision this surface offers. */
                        <GlassButton
                          className="glass-button--haze-light shrink-0"
                          size="none"
                          type="button"
                          buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                          contentClassName={GLASS_BOX.h10.content}
                          onClick={markAchieved}
                        >
                          <span className="inline-flex items-center gap-2">
                            <Trophy className="size-4" aria-hidden="true" />
                            Mark achieved
                          </span>
                        </GlassButton>
                      )}

                      {!detail.achieved ? (
                        goal.status === 'paused' ? (
                          <button
                            type="button"
                            onClick={() => setStatus('active')}
                            className={QUIET_PILL}
                          >
                            <Play className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setStatus('paused')}
                            className={QUIET_PILL}
                          >
                            <Pause className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                            Pause
                          </button>
                        )
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setEditorOpen(true)}
                        className={QUIET_PILL}
                      >
                        <PencilLine className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                        Edit
                      </button>

                      <span className="flex-1" aria-hidden="true" />

                      <button
                        type="button"
                        onClick={remove}
                        aria-label={
                          confirmingDelete
                            ? `Confirm deleting "${goal.title}"`
                            : `Delete "${goal.title}"`
                        }
                        style={confirmingDelete ? { borderColor: RED_EDGE } : undefined}
                        className={clsx(
                          'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4',
                          'text-[13px] font-medium transition-colors duration-150',
                          PILL_FOCUS,
                          confirmingDelete
                            ? 'bg-[color:var(--pa-red-bg)] text-[color:var(--pa-red)]'
                            : clsx(
                                'border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)]',
                                'text-[color:var(--pa-faint)]',
                                'hover:border-[color:var(--pa-red)] hover:text-[color:var(--pa-red)]',
                              ),
                        )}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                        {confirmingDelete ? 'Confirm delete' : 'Delete'}
                      </button>
                    </div>

                    <AnimatePresence initial={false}>
                      {confirmingDelete ? (
                        <motion.p
                          initial={{ opacity: 0, height: reduce ? 'auto' : 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: reduce ? 'auto' : 0 }}
                          transition={{ duration: 0.2, ease: HOUSE_EASE }}
                          className="overflow-hidden text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]"
                        >
                          <span className="block pt-2.5">
                            Its milestones go with it. Linked tasks are kept and simply unfiled.
                          </span>
                        </motion.p>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <div className="px-7 py-14 text-center">
                  <DialogTitle className="pa-title text-[15px]">Goal unavailable</DialogTitle>
                  <DialogDescription className="mt-2 text-[13px] text-[color:var(--pa-muted)]">
                    This goal is no longer in your system.
                  </DialogDescription>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* The editor stacks above the detail surface, so closing it returns you
          to the goal rather than to the grid. */}
      <GoalComposerDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        goalId={goal ? goal.id : null}
      />
    </>
  );
}

/* -------------------------------------------------------------------------
 * The composer — create and edit, one form
 * ---------------------------------------------------------------------- */

export interface GoalComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits that goal instead of creating a new one. */
  goalId?: ID | null;
  /** Pre-selects a life area on a brand-new goal. */
  defaultAreaId?: ID | null;
}

interface Draft {
  title: string;
  why: string;
  horizon: GoalHorizon;
  areaId: ID | null;
  parentGoalId: ID | null;
  targetDate: DayKey | null;
}

export function GoalComposerDialog({
  open,
  onOpenChange,
  goalId = null,
  defaultAreaId = null,
}: GoalComposerDialogProps): JSX.Element {
  const { data, actions } = useAssistant();
  const reduce = useReducedMotion();
  const fieldId = useId();

  const editing = useMemo<Goal | null>(
    () => (goalId === null ? null : (data.goals.find((g) => g.id === goalId) ?? null)),
    [data.goals, goalId],
  );

  const [draft, setDraft] = useState<Draft>({
    title: '',
    why: '',
    horizon: 'quarter',
    areaId: defaultAreaId,
    parentGoalId: null,
    targetDate: null,
  });
  const [showError, setShowError] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  /* Each opening starts from the truth, not from whatever was typed last time. */
  useEffect(() => {
    if (!open) return;
    setShowError(false);
    setDraft(
      editing
        ? {
            title: editing.title,
            why: editing.why,
            horizon: editing.horizon,
            areaId: editing.areaId,
            parentGoalId: editing.parentGoalId,
            targetDate: editing.targetDate,
          }
        : {
            title: '',
            why: '',
            horizon: 'quarter',
            areaId: defaultAreaId,
            parentGoalId: null,
            targetDate: null,
          },
    );
    // `editing` is intentionally read only at open time — live edits elsewhere
    // must not yank the field out from under the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const areas = useMemo<LifeArea[]>(
    () => [...data.areas].sort((a, b) => a.order - b.order),
    [data.areas],
  );

  const patch = useCallback((next: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const laddersUp = draft.horizon !== 'vision';
  const valid = draft.title.trim().length > 0;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const title = draft.title.trim();
    if (title.length === 0) {
      setShowError(true);
      titleRef.current?.focus();
      return;
    }

    const parentGoalId = laddersUp ? draft.parentGoalId : null;

    if (editing) {
      actions.updateGoal(editing.id, {
        title,
        why: draft.why.trim(),
        horizon: draft.horizon,
        areaId: draft.areaId,
        parentGoalId,
        targetDate: draft.targetDate,
      });
      toast.success('Goal updated', { description: title });
    } else {
      actions.addGoal({
        title,
        why: draft.why.trim(),
        horizon: draft.horizon,
        areaId: draft.areaId,
        parentGoalId,
        targetDate: draft.targetDate,
      });
      toast.success('Goal created', { description: `${HORIZON_LABEL[draft.horizon]} · ${title}` });
    }

    onOpenChange(false);
  };

  const pillTransition = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 380, damping: 32 } as const);

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
                  style={{
                    background:
                      'radial-gradient(closest-side, var(--pa-accent-bg-strong), transparent 74%)',
                  }}
                />

                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="pa-chip-solid size-10 shrink-0 rounded-[0.9rem]"
                      aria-hidden="true"
                    >
                      <Target className="size-[18px]" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="pa-eyebrow leading-none">
                        {editing ? 'Edit goal' : 'New goal'}
                      </p>
                      <DialogTitle className="pa-title mt-1.5 text-[17px] leading-snug">
                        {editing ? editing.title : 'What are you working towards?'}
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
                  Set the title, the reason it matters, the horizon it belongs to, the life area it
                  serves and an optional target date.
                </DialogDescription>
              </DialogHeader>

              {/* ---- fields ---- */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
                {/* title */}
                <div>
                  <label htmlFor={`${fieldId}-title`} className={FIELD_LABEL}>
                    Goal
                  </label>
                  <input
                    ref={titleRef}
                    id={`${fieldId}-title`}
                    type="text"
                    value={draft.title}
                    onChange={(event) => {
                      patch({ title: capitaliseOnType(event) });
                      if (showError) setShowError(false);
                    }}
                    placeholder="Run a sub-90 half marathon"
                    autoComplete="off"
                    aria-invalid={showError}
                    aria-describedby={showError ? `${fieldId}-title-error` : undefined}
                    className="pa-input h-11 px-3.5 text-[14px]"
                  />
                  <AnimatePresence initial={false}>
                    {showError ? (
                      <motion.p
                        id={`${fieldId}-title-error`}
                        initial={{ opacity: 0, y: reduce ? 0 : -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: HOUSE_EASE }}
                        className="mt-2 text-[12px] text-[color:var(--pa-red)]"
                      >
                        Give the goal a name — one line you would recognise in a year.
                      </motion.p>
                    ) : null}
                  </AnimatePresence>
                </div>

                {/* why */}
                <div>
                  <label htmlFor={`${fieldId}-why`} className={FIELD_LABEL}>
                    Why it matters
                  </label>
                  <textarea
                    id={`${fieldId}-why`}
                    value={draft.why}
                    onChange={(event) => patch({ why: capitaliseOnType(event) })}
                    rows={3}
                    placeholder="The reason you will still want this in November."
                    className="pa-input resize-none px-3.5 py-2.5 text-[13.5px] leading-relaxed"
                  />
                </div>

                {/* horizon */}
                <div>
                  <span className={FIELD_LABEL}>Horizon</span>
                  <div role="group" aria-label="Goal horizon" className="pa-seg flex-wrap">
                    {HORIZON_ORDER.map((horizon) => {
                      const active = draft.horizon === horizon;
                      return (
                        <button
                          key={horizon}
                          type="button"
                          onClick={() => patch({ horizon })}
                          data-active={active}
                          aria-pressed={active}
                          className="pa-seg-btn pa-focus"
                        >
                          {active ? (
                            <motion.span
                              layoutId="pa-goal-form-horizon"
                              className="pa-seg-pill"
                              transition={pillTransition}
                            />
                          ) : null}
                          <span className="relative z-[1]">{HORIZON_LABEL[horizon]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                    {HORIZON_HINT[draft.horizon]}
                  </p>
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
                      No life areas yet — the goal will sit unfiled until you make one.
                    </p>
                  ) : null}
                </div>

                {/* parent + target date */}
                <div className={clsx('grid gap-4', laddersUp ? 'sm:grid-cols-2' : '')}>
                  <AnimatePresence initial={false}>
                    {laddersUp ? (
                      <motion.div
                        key="parent"
                        initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                        transition={{ duration: 0.22, ease: HOUSE_EASE }}
                      >
                        <span className={FIELD_LABEL}>Ladders up to</span>
                        <GoalPicker
                          value={draft.parentGoalId}
                          placeholder="A bigger goal (optional)"
                          onChange={(next) => {
                            if (editing && next === editing.id) {
                              toast.error('A goal cannot support itself');
                              return;
                            }
                            patch({ parentGoalId: next });
                          }}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  <div>
                    <label htmlFor={`${fieldId}-date`} className={FIELD_LABEL}>
                      Target date
                    </label>
                    <input
                      id={`${fieldId}-date`}
                      type="date"
                      value={draft.targetDate ?? ''}
                      onChange={(event) =>
                        patch({ targetDate: event.target.value === '' ? null : event.target.value })
                      }
                      /* No `[color-scheme:…]` here on purpose: the shell sets
                         `color-scheme: dark` alongside the dark tokens, so the
                         native picker and its indicator follow the theme. */
                      className={clsx(
                        'pa-input h-10 px-3.5 text-[13.5px]',
                        '[&::-webkit-calendar-picker-indicator]:cursor-pointer',
                        '[&::-webkit-calendar-picker-indicator]:opacity-45',
                        '[&::-webkit-calendar-picker-indicator]:hover:opacity-80',
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* ---- footer ---- */}
              <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[color:var(--pa-line)] bg-[color:var(--pa-well)] px-5 py-4 sm:px-7">
                <button type="button" onClick={() => onOpenChange(false)} className={QUIET_PILL}>
                  Cancel
                </button>

                {/* The form's one primary action. The wrapper carries the dimming
                    while the title is empty, since the disabled state lives on the
                    inner <button> and cannot reach the glass layers around it. */}
                <GlassButton
                  className={clsx(
                    'glass-button--haze-light shrink-0',
                    !valid && 'cursor-not-allowed opacity-45',
                  )}
                  size="none"
                  type="submit"
                  disabled={!valid}
                  buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                  contentClassName={GLASS_BOX.h10.content}
                >
                  <span className="inline-flex items-center gap-2">
                    <Check className="size-4" aria-hidden="true" />
                    {editing ? 'Save changes' : 'Create goal'}
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

interface AreaChipProps {
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
        active
          ? 'border-[color:var(--pa-accent-border)] bg-[color:var(--pa-accent-bg)] text-[color:var(--pa-navy)]'
          : clsx(
              'border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)]',
              'text-[color:var(--pa-muted)]',
              'hover:border-[color:var(--pa-accent-ring)] hover:text-[color:var(--pa-navy)]',
            ),
      )}
    >
      {/* The dot is the area's own stored colour — user data, left alone. Only
          the "Unfiled" placeholder falls back to a token. */}
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{
          background: color ?? 'var(--pa-faint)',
          boxShadow: active && color ? `0 0 0 3px ${color}1f` : undefined,
        }}
      />
      <span className="max-w-[14ch] truncate">{label}</span>
    </button>
  );
}
