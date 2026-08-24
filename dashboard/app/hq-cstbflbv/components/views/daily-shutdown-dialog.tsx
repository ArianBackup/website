'use client';

/* ---------------------------------------------------------------------------
 * daily-shutdown-dialog.tsx — the ritual that closes a day.
 *
 * It used to live inside review-view.tsx. It is a component of its own now
 * because two surfaces want to start it: the Review tab's altar, and the Today
 * tab at the point where the day is actually ending. Both mount this and own
 * nothing but the `open` boolean.
 *
 * THE LIVE DAY
 * ------------
 * `anchorDay === null` means "whatever day it is right now": an untouched form
 * follows the provider's live clock straight over midnight and re-seeds itself
 * for the new day. The first keystroke pins the draft to the day it was started
 * on, so the clock can never retarget words you have already written.
 *
 * THE SHARED WIZARD CHROME
 * ------------------------
 * `WizardShell` and its parts are exported from here rather than from
 * review-view.tsx, so the dependency runs one way: the weekly review imports
 * this file, this file imports nothing back. Today can mount the dialog without
 * dragging the whole review timeline in behind it.
 *
 * Radix portals the dialog to <body>, outside `.assistant-shell`, so it carries
 * its own shell wrapper. `pa-portal` strips the host's frosting off the portal
 * container (that was the doubled corner), and the `.pa-sheet` inside owns
 * every pixel — including the header and footer, which are clipped to its
 * radius by `overflow-hidden`.
 * ------------------------------------------------------------------------- */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CalendarArrowDown,
  Check,
  Lightbulb,
  Moon,
  Quote,
  Sparkles,
  Star,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

import { capitaliseOnType } from '../../lib/capitalise';
import { addDaysKey, formatKey, relativeDayLabel } from '../../lib/dates';
import {
  big3ForDay,
  dayProgress,
  habitsDueOn,
  isHabitDone,
  overdueTasks,
  tasksForDay,
} from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { AssistantData, DayKey, ReviewReflections } from '../../lib/types';

import { Meter } from '../shared/meter';
import { ProgressRing } from '../shared/progress-ring';

/* =========================================================================
 * Shared constants — the wizard chrome's vocabulary
 * ====================================================================== */

export const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** Neutralises `.assistant-shell`'s page geometry inside a Radix portal. */
export const PORTAL_SHELL = { minHeight: 0, overflowX: 'visible' } as const;

/* The portal container is stripped back to a bare positioning box by
 * `pa-portal` (see the reset at the foot of assistant.css); these classes only
 * decide how wide and how transparent that box is. */
export const WIZARD_CONTENT = clsx(
  'block w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] gap-0',
  'border-0 bg-transparent p-0 shadow-none',
);

/** The surface itself: one rounded sheet that clips its own header and footer. */
export const WIZARD_SURFACE = 'pa-sheet flex max-h-[min(90dvh,860px)] flex-col overflow-hidden';

/* The scrim renders outside `.assistant-shell`, where the `--pa-*` tokens do
 * not resolve — so it is a deep navy black that reads as a modal dim on the
 * light stage and as a deepening on the dark one. */
export const WIZARD_OVERLAY = 'bg-[rgba(8,20,44,0.44)] backdrop-blur-[3px]';

/** Keeps a pill's shape while focused, which `.pa-focus` would square off. */
export const PILL_FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--pa-accent-ring)]';

/** The quiet bordered pill used for every secondary decision. */
export const QUIET_PILL = clsx(
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4',
  'border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)]',
  'text-[13px] font-medium text-[color:var(--pa-muted)]',
  'transition-colors duration-150',
  'hover:border-[color:var(--pa-accent-border)] hover:bg-[color:var(--pa-row-hover)]',
  'hover:text-[color:var(--pa-navy)]',
  PILL_FOCUS,
);

/* The glass pill carries no focus style of its own, and its look is built out of
 * five stacked box-shadows — so the keyboard ring has to be an OUTLINE, which
 * follows the pill's radius without touching any of that. */
export const GLASS_FOCUS = clsx(
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-[color:var(--pa-azure)]',
);

/* A dot that has not been filled in yet. `--pa-sunken` is the track colour for
 * meters and rings, but at six pixels it disappears on the dark stage — mixing
 * the tertiary ink down keeps one value legible on both themes. */
export const DOT_TRACK = 'color-mix(in srgb, var(--pa-faint) 40%, transparent)';

/** The five points of a day, said in words rather than stars. */
export const RATING_WORDS = ['Rough', 'Off', 'Steady', 'Good', 'Excellent'];

const DAILY_STEPS = ['Rate', 'Reflect', 'Tomorrow'];

/* =========================================================================
 * Shared pure helpers
 * ====================================================================== */

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function trimReflections(
  draft: ReviewReflections,
  keys: (keyof ReviewReflections)[],
): ReviewReflections {
  const out: ReviewReflections = {};
  for (const key of keys) out[key] = (draft[key] ?? '').trim();
  return out;
}

interface DailySeed {
  rating: number | null;
  reflections: ReviewReflections;
  big3: string[];
}

/** Everything the daily form should say about `day`, read straight off the document. */
function seedFromData(data: AssistantData, day: DayKey): DailySeed {
  const existing = data.reviews.find((r) => r.type === 'daily' && r.date === day) ?? null;
  const planned = big3ForDay(data, addDaysKey(day, 1));
  const saved = existing?.tomorrowBig3 ?? [];

  return {
    rating: existing?.rating ?? null,
    reflections: {
      wins: existing?.reflections.wins ?? '',
      challenges: existing?.reflections.challenges ?? '',
      lessons: existing?.reflections.lessons ?? '',
    },
    big3: [0, 1, 2].map((index) => saved[index] ?? planned[index]?.title ?? ''),
  };
}

/* =========================================================================
 * Wizard chrome — shared by the daily and the weekly flow
 * ====================================================================== */

export interface StepRailProps {
  steps: string[];
  step: number;
  /** The furthest step reached, so travelling backwards stays possible. */
  maxStep: number;
  /** Namespaces the sliding dot's `layoutId`. */
  railId: string;
  onStep: (next: number) => void;
}

export function StepRail({ steps, step, maxStep, railId, onStep }: StepRailProps): JSX.Element {
  const reduce = useReducedMotion();

  return (
    <div className="mt-5">
      <div role="tablist" aria-label="Review steps" className="flex items-center gap-0.5">
        {steps.map((label, index) => {
          const current = index === step;
          const reachable = index <= maxStep;

          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={current}
              disabled={!reachable}
              onClick={() => onStep(index)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-medium',
                'transition-colors duration-200',
                PILL_FOCUS,
                current
                  ? 'text-[color:var(--pa-navy)]'
                  : reachable
                    ? 'text-[color:var(--pa-faint)] hover:text-[color:var(--pa-muted)]'
                    : 'text-[color:var(--pa-faint)] opacity-45',
              )}
            >
              <span className="relative inline-flex size-2 shrink-0" aria-hidden>
                {current ? (
                  <motion.span
                    layoutId={`${railId}-step-dot`}
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'var(--pa-grad)',
                      boxShadow: '0 0 0 3px var(--pa-accent-glow)',
                    }}
                    transition={
                      reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }
                    }
                  />
                ) : (
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: index < step ? 'var(--pa-accent-border)' : DOT_TRACK,
                    }}
                  />
                )}
              </span>
              {label}
            </button>
          );
        })}

        <span className="ml-auto pr-0.5 text-[11px] tabular-nums leading-none text-[color:var(--pa-faint)]">
          {step + 1}/{steps.length}
        </span>
      </div>

      <Meter value={(step + 1) / steps.length} thin className="mt-2.5" />
    </div>
  );
}

export interface WizardShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  /** Screen-reader description of the whole flow. */
  description: string;
  steps: string[];
  step: number;
  maxStep: number;
  /** `1` when moving forwards, `-1` when moving back — drives the slide. */
  direction: number;
  railId: string;
  onStep: (next: number) => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  submitLabel: string;
  /** Width override for the dialog surface. */
  widthClassName?: string;
  children: ReactNode;
}

export function WizardShell({
  open,
  onOpenChange,
  icon: Icon,
  eyebrow,
  title,
  description,
  steps,
  step,
  maxStep,
  direction,
  railId,
  onStep,
  onBack,
  onNext,
  onSubmit,
  submitLabel,
  widthClassName = 'sm:max-w-[660px]',
  children,
}: WizardShellProps): JSX.Element {
  const reduce = useReducedMotion();
  const last = step === steps.length - 1;
  const offset = reduce ? 0 : 24;

  /* ⌘↵ finishes the step you are on, wherever the caret happens to be. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (last) onSubmit();
    else onNext();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={WIZARD_OVERLAY}
        className={clsx('pa-portal', WIZARD_CONTENT, widthClassName)}
      >
        <div className="assistant-shell" style={PORTAL_SHELL} onKeyDown={handleKeyDown}>
          <div className={WIZARD_SURFACE}>
            {/* ---------------- header ---------------- */}
            <DialogHeader className="relative shrink-0 gap-0 border-b border-[color:var(--pa-line)] px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
              <span
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-14 size-44 rounded-full"
                style={{
                  background:
                    'radial-gradient(closest-side, var(--pa-accent-bg-strong), transparent 74%)',
                }}
              />

              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="pa-chip-solid size-10 shrink-0 rounded-[0.9rem]" aria-hidden>
                    <Icon className="size-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="pa-eyebrow leading-none">{eyebrow}</p>
                    <DialogTitle className="pa-title mt-1.5 truncate text-[17px] leading-snug">
                      {title}
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
                  <X className="size-4" strokeWidth={1.9} aria-hidden />
                </button>
              </div>

              <DialogDescription className="sr-only">{description}</DialogDescription>

              <StepRail
                steps={steps}
                step={step}
                maxStep={maxStep}
                railId={railId}
                onStep={onStep}
              />
            </DialogHeader>

            {/* ---------------- body ---------------- */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
              <div className="min-h-[290px] sm:min-h-[330px]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: direction >= 0 ? offset : -offset }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: direction >= 0 ? -offset : offset }}
                    transition={{ duration: 0.26, ease: HOUSE_EASE }}
                  >
                    {children}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* ---------------- footer ---------------- */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--pa-line)] bg-[color:var(--pa-well)] px-5 py-4 sm:px-7">
              <button
                type="button"
                onClick={step === 0 ? () => onOpenChange(false) : onBack}
                className={QUIET_PILL}
              >
                {step === 0 ? (
                  'Cancel'
                ) : (
                  <>
                    <ArrowLeft className="size-3.5" strokeWidth={1.9} aria-hidden />
                    Back
                  </>
                )}
              </button>

              <div className="flex items-center gap-2.5">
                <kbd className="hidden rounded-[0.4rem] border border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)] px-1.5 py-px font-sans text-[10.5px] font-medium text-[color:var(--pa-faint)] sm:inline-block">
                  ⌘ ↵
                </kbd>

                <GlassButton
                  className="glass-button--haze-light shrink-0"
                  size="none"
                  type="button"
                  buttonClassName={clsx(GLASS_BOX.h10.button, GLASS_FOCUS)}
                  contentClassName={GLASS_BOX.h10.content}
                  onClick={last ? onSubmit : onNext}
                >
                  {last ? (
                    <span className="inline-flex items-center gap-2">
                      <Check className="size-4" aria-hidden="true" />
                      {submitLabel}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      Next
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </span>
                  )}
                </GlassButton>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------
 * Wizard parts
 * ---------------------------------------------------------------------- */

export interface StepHeadingProps {
  title: string;
  hint: string;
}

export function StepHeading({ title, hint }: StepHeadingProps): JSX.Element {
  return (
    <div className="mb-5">
      <h3 className="pa-title text-[17px] leading-snug">{title}</h3>
      <p className="mt-1.5 max-w-[54ch] text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
        {hint}
      </p>
    </div>
  );
}

export interface RatingPickerProps {
  /** 1–5, or `null` when the day has not been rated. */
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  /** Namespaces the sliding gradient's `layoutId`. */
  pickerId: string;
  /** Shorter buttons, for the weekly flow where the stats lead. */
  compact?: boolean;
  className?: string;
}

export function RatingPicker({
  value,
  onChange,
  label,
  pickerId,
  compact = false,
  className,
}: RatingPickerProps): JSX.Element {
  const reduce = useReducedMotion();

  return (
    <div role="group" aria-label={label} className={clsx('grid grid-cols-5 gap-1.5', className)}>
      {RATING_WORDS.map((word, index) => {
        const score = index + 1;
        const active = value === score;

        return (
          <div key={word} className="min-w-0">
            <button
              type="button"
              aria-pressed={active}
              aria-label={`${score} out of 5 — ${word}`}
              onClick={() => onChange(active ? null : score)}
              className={clsx(
                'pa-focus relative flex w-full items-center justify-center overflow-hidden rounded-[0.9rem] border',
                'transition-colors duration-200',
                compact ? 'h-11' : 'h-14 sm:h-16',
                active
                  ? 'border-transparent text-white'
                  : clsx(
                      'border-[color:var(--pa-line)] bg-[color:var(--pa-tile)] text-[color:var(--pa-muted)]',
                      'hover:border-[color:var(--pa-accent-border)] hover:bg-[color:var(--pa-row-hover)]',
                      'hover:text-[color:var(--pa-navy)]',
                    ),
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`${pickerId}-rating-fill`}
                  className="absolute inset-0"
                  style={{
                    background: 'var(--pa-grad)',
                    boxShadow: 'var(--pa-shadow)',
                  }}
                  transition={
                    reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }
                  }
                />
              ) : null}
              <span
                className={clsx(
                  'relative tabular-nums leading-none',
                  compact ? 'text-[15px]' : 'text-[19px] sm:text-[21px]',
                )}
              >
                {score}
              </span>
            </button>

            <span
              className={clsx(
                'mt-2 block truncate text-center leading-none transition-colors duration-200',
                compact ? 'text-[10px]' : 'text-[10.5px] sm:text-[11px]',
                active ? 'text-[color:var(--pa-navy)]' : 'text-[color:var(--pa-faint)]',
              )}
            >
              {word}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface ReflectFieldProps {
  id: string;
  label: string;
  prompt: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  index: number;
}

export function ReflectField({
  id,
  label,
  prompt,
  icon: Icon,
  value,
  onChange,
  index,
}: ReflectFieldProps): JSX.Element {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.05, 0.3),
      }}
    >
      <label
        htmlFor={id}
        className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.11em] text-[color:var(--pa-faint)]"
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(capitaliseOnType(event))}
        placeholder={prompt}
        className="pa-input min-h-[86px] resize-y px-3.5 py-2.5 text-[13.5px] leading-relaxed"
      />
    </motion.div>
  );
}

export interface MiniStatProps {
  label: string;
  value: string;
}

export function MiniStat({ label, value }: MiniStatProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 rounded-[0.8rem] bg-[color:var(--pa-well)] px-2 py-2.5">
      <span className="text-[9.5px] uppercase leading-none tracking-[0.13em] text-[color:var(--pa-faint)]">
        {label}
      </span>
      <span className="text-[15px] tabular-nums leading-none text-[color:var(--pa-navy)]">
        {value}
      </span>
    </div>
  );
}

/* =========================================================================
 * The daily shutdown
 * ====================================================================== */

export interface DailyShutdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DailyShutdownDialog({
  open,
  onOpenChange,
}: DailyShutdownDialogProps): JSX.Element {
  const { data, today, actions } = useAssistant();
  const fieldId = useId();

  /* `null` = "whatever day it is right now". The form follows the live clock
   * while it is untouched, and pins itself the moment anything is typed. */
  const [anchorDay, setAnchorDay] = useState<DayKey | null>(null);
  const day = anchorDay ?? today;
  const tomorrow = addDaysKey(day, 1);

  /* ---- draft ---- */
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [rating, setRating] = useState<number | null>(null);
  const [reflections, setReflections] = useState<ReviewReflections>({});
  const [big3, setBig3] = useState<string[]>(['', '', '']);
  const [carry, setCarry] = useState(true);

  /* The latest document, without making the seeding effect depend on every edit
   * made anywhere else in the app. Declared FIRST so it is already fresh by the
   * time the effects below run in the same commit. */
  const dataRef = useRef<AssistantData>(data);
  useEffect(() => {
    dataRef.current = data;
  });

  /* ---- derived ---- */

  const existing = useMemo(
    () => data.reviews.find((r) => r.type === 'daily' && r.date === day) ?? null,
    [data.reviews, day],
  );

  const progress = useMemo(() => dayProgress(data, day), [data, day]);
  const dayTasks = useMemo(() => tasksForDay(data, day), [data, day]);
  const habits = useMemo(() => habitsDueOn(data, day), [data, day]);
  const habitsDone = useMemo(
    () => habits.filter((habit) => isHabitDone(data.habitLogs, habit.id, day)).length,
    [habits, data.habitLogs, day],
  );
  const tasksDone = dayTasks.filter((task) => task.completedAt !== null).length;

  /** Everything unfinished before tomorrow — exactly what `carryOverTo` moves. */
  const stragglers = useMemo(() => overdueTasks(data, tomorrow), [data, tomorrow]);

  /* ---- opening, and the day turning underneath ---- */

  /* Each opening starts from the truth, not from whatever was typed last time.
   * Closing releases the anchor so the next opening is live again. */
  useEffect(() => {
    setAnchorDay(null);
    if (!open) return;
    setStep(0);
    setMaxStep(0);
    setDirection(1);
    setCarry(true);
  }, [open]);

  /* Seeds on open — and RE-seeds if midnight moves the day under a form nobody
   * has touched. Once `anchorDay` is pinned this never fires again, so a draft
   * in progress is never yanked out from under the cursor. */
  useEffect(() => {
    if (!open || anchorDay !== null) return;
    const seed = seedFromData(dataRef.current, today);
    setRating(seed.rating);
    setReflections(seed.reflections);
    setBig3(seed.big3);
  }, [open, today, anchorDay]);

  /** The first edit pins the draft to the day it was started on. */
  const touch = useCallback((): void => {
    setAnchorDay((current) => current ?? day);
  }, [day]);

  /* ---- edits ---- */

  const handleRating = useCallback(
    (value: number | null): void => {
      touch();
      setRating(value);
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

  const handleBig3 = useCallback(
    (index: number, value: string): void => {
      touch();
      setBig3((draft) => draft.map((entry, position) => (position === index ? value : entry)));
    },
    [touch],
  );

  const toggleCarry = useCallback((): void => {
    touch();
    setCarry((value) => !value);
  }, [touch]);

  /* ---- navigation ---- */

  const goTo = useCallback(
    (next: number): void => {
      const clamped = Math.max(0, Math.min(next, DAILY_STEPS.length - 1));
      setDirection(clamped >= step ? 1 : -1);
      setStep(clamped);
      setMaxStep((furthest) => Math.max(furthest, clamped));
    },
    [step],
  );

  /* ---- save ---- */

  const submit = useCallback((): void => {
    const titles = big3.map((title) => title.trim());
    const named = titles.filter((title) => title.length > 0);

    actions.saveReview({
      type: 'daily',
      date: day,
      rating,
      reflections: trimReflections(reflections, ['wins', 'challenges', 'lessons']),
      tomorrowBig3: titles,
    });

    const moved = carry ? actions.carryOverTo(tomorrow) : 0;

    const parts: string[] = [];
    if (named.length > 0) {
      parts.push(
        `${named.length} ${plural(named.length, 'priority', 'priorities')} set for ${
          tomorrow === addDaysKey(today, 1) ? 'tomorrow' : formatKey(tomorrow, 'EEEE')
        }`,
      );
    }
    if (moved > 0) {
      parts.push(`${moved} ${plural(moved, 'task', 'tasks')} carried forward`);
    }

    toast.success(existing ? 'Shutdown updated' : 'Day closed', {
      description: parts.length > 0 ? `${parts.join(' · ')}.` : 'Tomorrow starts clean.',
    });

    onOpenChange(false);
  }, [actions, big3, carry, day, existing, onOpenChange, rating, reflections, today, tomorrow]);

  /* ---- the three steps ---- */

  let body: ReactNode = null;

  if (step === 0) {
    body = (
      <div>
        <StepHeading
          title={day === today ? 'How was today?' : 'How was that day?'}
          hint="Rate the day as it actually felt. The numbers beside it are context, not a verdict."
        />

        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <div className="min-w-0 flex-1">
            <RatingPicker
              value={rating}
              onChange={handleRating}
              label="How was the day?"
              pickerId="pa-daily"
            />

            <div className="pa-well mt-5 flex items-start gap-3 p-3.5">
              <span className="pa-chip mt-0.5 size-7 shrink-0 rounded-[0.6rem]" aria-hidden>
                <Quote className="size-3.5" strokeWidth={1.9} />
              </span>
              <p className="text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
                {rating === null
                  ? 'A hard day that taught you something still counts. Pick the number you would give it out loud.'
                  : rating >= 4
                    ? 'Worth knowing what made it work — you get to ask for that again tomorrow.'
                    : rating === 3
                      ? 'Most days are threes. A run of threes is what a good year is actually made of.'
                      : 'One bad day is data, not a trend. Name what got in the way on the next screen.'}
              </p>
            </div>
          </div>

          <div className="pa-tile flex shrink-0 flex-col items-center gap-4 p-4 sm:w-[204px]">
            {/* An empty day is unmeasured, not a zero — the dash says so. */}
            <ProgressRing
              value={progress.ratio}
              size={94}
              stroke={7}
              sublabel={relativeDayLabel(day, today)}
              label={progress.total === 0 ? '—' : undefined}
            />
            <div className="grid w-full grid-cols-2 gap-2">
              <MiniStat label="Tasks" value={`${tasksDone}/${dayTasks.length}`} />
              <MiniStat label="Habits" value={`${habitsDone}/${habits.length}`} />
            </div>
          </div>
        </div>
      </div>
    );
  } else if (step === 1) {
    body = (
      <div>
        <StepHeading
          title="Reflect"
          hint="Three questions, one line each. Nothing here is compulsory — an empty box is an honest answer."
        />

        <div className="space-y-5">
          <ReflectField
            id={`${fieldId}-wins`}
            index={0}
            icon={Sparkles}
            label="What went well?"
            prompt="The thing you would actually tell someone about today."
            value={reflections.wins ?? ''}
            onChange={(value) => handleReflection('wins', value)}
          />
          <ReflectField
            id={`${fieldId}-challenges`}
            index={1}
            icon={TriangleAlert}
            label="What got in the way?"
            prompt="Where the day lost its shape. Be specific rather than harsh."
            value={reflections.challenges ?? ''}
            onChange={(value) => handleReflection('challenges', value)}
          />
          <ReflectField
            id={`${fieldId}-lessons`}
            index={2}
            icon={Lightbulb}
            label="What did you learn?"
            prompt="One line you would want to read again in a month."
            value={reflections.lessons ?? ''}
            onChange={(value) => handleReflection('lessons', value)}
          />
        </div>
      </div>
    );
  } else {
    const preview = stragglers
      .slice(0, 2)
      .map((task) => task.title)
      .join(' · ');

    body = (
      <div>
        <StepHeading
          title={`Next up — ${formatKey(tomorrow, 'EEEE')}`}
          hint="Decide the three things now, while today is still fresh. Morning-you will thank tonight-you."
        />

        <div className="space-y-2.5">
          {big3.map((title, index) => (
            <div key={`pa-daily-big3-${index}`} className="pa-tile flex items-center gap-3 p-2.5">
              <span className="pa-avatar size-8 text-[13px] tabular-nums" aria-hidden>
                {index + 1}
              </span>
              <input
                type="text"
                value={title}
                onChange={(event) => handleBig3(index, capitaliseOnType(event))}
                placeholder={
                  index === 0
                    ? 'The one that would make tomorrow count…'
                    : index === 1
                      ? 'The second thing that actually matters…'
                      : 'And the third…'
                }
                aria-label={`Priority ${index + 1} for ${formatKey(tomorrow, 'EEEE')}`}
                autoComplete="off"
                className={clsx(
                  'min-w-0 flex-1 border-0 bg-transparent py-1.5 text-[13.5px] outline-none',
                  'text-[color:var(--pa-navy)] placeholder:text-[color:var(--pa-faint)]',
                )}
              />
              <Star
                className={clsx(
                  'size-4 shrink-0 transition-colors duration-200',
                  title.trim().length > 0
                    ? 'text-[color:var(--pa-azure)]'
                    : 'text-[color:var(--pa-line)]',
                )}
                strokeWidth={1.9}
                fill={title.trim().length > 0 ? 'currentColor' : 'none'}
                aria-hidden
              />
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
          Anything you name here is created as a real task on {formatKey(tomorrow, 'EEEE')}, already
          ranked as that day&rsquo;s Big Three.
        </p>

        <hr className="pa-divider my-5" />

        {stragglers.length > 0 ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={carry}
            onClick={toggleCarry}
            className={clsx(
              'pa-tile pa-focus group flex w-full items-center gap-3.5 p-4 text-left',
              'transition-colors duration-200 hover:border-[color:var(--pa-accent-ring)]',
            )}
          >
            <span className="pa-check" data-checked={carry ? 'true' : 'false'} aria-hidden>
              <AnimatePresence initial={false}>
                {carry ? (
                  <motion.span
                    key="tick"
                    className="flex items-center justify-center"
                    initial={{ scale: 0.35, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.35, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 24 }}
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] leading-snug text-[color:var(--pa-navy)]">
                Carry {stragglers.length} unfinished {plural(stragglers.length, 'task', 'tasks')}{' '}
                forward
              </span>
              <span className="mt-1 block truncate text-[11.5px] leading-none text-[color:var(--pa-faint)]">
                {preview}
                {stragglers.length > 2 ? ` · +${stragglers.length - 2} more` : ''}
              </span>
            </span>

            <CalendarArrowDown
              className="size-4 shrink-0 text-[color:var(--pa-faint)]"
              strokeWidth={1.9}
              aria-hidden
            />
          </button>
        ) : (
          <div className="pa-well flex items-center gap-3 p-4">
            <span className="pa-chip size-8 shrink-0 rounded-[0.7rem]" aria-hidden>
              <Check className="size-4" strokeWidth={2.25} />
            </span>
            <p className="text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
              Nothing is left open from earlier days. Tomorrow starts clean.
            </p>
          </div>
        )}
      </div>
    );
  }

  /* When the clock has moved past the day this draft belongs to, the eyebrow
   * says so rather than letting the title quietly lie. */
  const stale = day !== today;
  const eyebrow = stale
    ? `${existing ? 'Editing' : 'Daily shutdown'} · ${relativeDayLabel(day, today)}`
    : existing
      ? 'Editing tonight’s shutdown'
      : 'Daily shutdown';

  return (
    <WizardShell
      open={open}
      onOpenChange={onOpenChange}
      icon={Moon}
      eyebrow={eyebrow}
      title={formatKey(day, 'EEEE d MMMM')}
      description="Rate the day, write three short reflections, then set the next day's Big Three and choose whether unfinished work rolls forward."
      steps={DAILY_STEPS}
      step={step}
      maxStep={maxStep}
      direction={direction}
      railId="pa-daily"
      onStep={goTo}
      onBack={() => goTo(step - 1)}
      onNext={() => goTo(step + 1)}
      onSubmit={submit}
      submitLabel="Complete shutdown"
      widthClassName="sm:max-w-[660px]"
    >
      {body}
    </WizardShell>
  );
}
