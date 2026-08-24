'use client';

/* ---------------------------------------------------------------------------
 * workouts-view.tsx — the week you trained.
 *
 *   1. the header — the week's three numbers, the week nav, and the unit
 *   2. seven day cards, each holding its own session
 *   3. the workout plan — see workout-plan.tsx
 *
 * A session is not an entity. It is simply the exercises that share a date —
 * so a day is filled by ASSIGNING it a plan, and emptied by clearing it. See
 * the note in lib/types.ts.
 *
 * WHY SEVEN STACKED CARDS AND NOT SEVEN COLUMNS
 * ---------------------------------------------
 * The Week board puts seven days side by side, and at the container's 1180px
 * that gives each one about 150px. A task is one line and fits; an exercise row
 * is a name, sets, reps and a counter, and does not — the counter alone is
 * wider than the column. So the days stack instead, two abreast once there is
 * room, and every row gets the full width it needs.
 *
 * ONE WAY A DAY GETS FILLED
 * -------------------------
 * You write the plans down once, in the Workout plan below, and then each day
 * is ASSIGNED one of them. There is no second path — no typing an exercise
 * straight onto the board, no naming a day by hand, no copying yesterday. Two
 * routes to the same result is two things to keep in step, and the day would
 * end up disagreeing with the plan it came from about what a leg day is.
 *
 * So what is editable on a day is only what you actually DID: the sets, the
 * reps, the load, and the tick. The names and the list belong to the plan.
 *
 * The LOADS a day arrives with come from what you lifted the last time you ran
 * that plan, not from the plan's original figures. See `applyPlan`.
 * ------------------------------------------------------------------------- */

import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { Check, ChevronLeft, ChevronRight, Dumbbell, Trash2 } from 'lucide-react';

import {
  addDaysKey,
  dayNumber,
  daysBetween,
  formatKey,
  isPastDay,
  isToday,
  relativeDayLabel,
  weekDaysFrom,
  weekStartKey,
  weekdayShort,
} from '../../lib/dates';
import { dayTraining, exercisesForDay, weekTraining } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { DayKey, Exercise, LoadUnit } from '../../lib/types';

import { NumberStepper } from '../shared/number-stepper';
import { SectionHeader } from '../shared/section-header';
import { StatTile } from '../shared/stat-tile';
import { PlanPicker, WorkoutPlanLibrary } from './workout-plan';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The smallest jump the plus and minus make.
 *
 * 2.5 kg is a pair of the smallest plates most racks carry; 5 lb is the same
 * idea in the other unit. Typing straight into the field is always available
 * for anything between.
 */
const LOAD_STEP: Record<LoadUnit, number> = { kg: 2.5, lb: 5 };

const UNITS: LoadUnit[] = ['kg', 'lb'];

/** Rounded so a week's volume reads as a figure rather than a serial number. */
function formatVolume(volume: number): string {
  if (volume >= 100_000) return `${Math.round(volume / 1000).toLocaleString()}k`;
  if (volume >= 10_000) return `${(volume / 1000).toFixed(1)}k`;
  return Math.round(volume).toLocaleString();
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function offsetLabel(offset: number): string {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  return offset > 0 ? `${offset} weeks ahead` : `${Math.abs(offset)} weeks back`;
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function WorkoutsView(): JSX.Element {
  const { data, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  const thisMonday = weekStartKey(today);
  const [monday, setMonday] = useState<DayKey>(thisMonday);

  const weekDays = useMemo(() => weekDaysFrom(monday), [monday]);
  const totals = useMemo(() => weekTraining(data, monday), [data, monday]);

  const unit = data.settings.loadUnit;
  const weekOffset = Math.round(daysBetween(thisMonday, monday) / 7);
  const isCurrentWeek = monday === thisMonday;

  const rangeLabel = useMemo(() => {
    const sunday = weekDays[6] ?? monday;
    const sameMonth = formatKey(monday, 'MMM yyyy') === formatKey(sunday, 'MMM yyyy');
    return sameMonth
      ? `${formatKey(monday, 'd')} – ${formatKey(sunday, 'd MMMM')}`
      : `${formatKey(monday, 'd MMM')} – ${formatKey(sunday, 'd MMM')}`;
  }, [monday, weekDays]);

  const setUnit = useCallback(
    (next: LoadUnit): void => {
      if (next === unit) return;
      /* The stored numbers are NOT converted. They are what you wrote on the
       * day, and silently multiplying a year of history by 2.20462 would turn
       * every past session into a number you never lifted. The unit is a label
       * for what you have been recording all along. */
      actions.updateSettings({ loadUnit: next });
      toast(`Loads now read in ${next}`, {
        description: 'Existing numbers are left as they were written.',
      });
    },
    [actions, unit],
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
    <div className="space-y-4 sm:space-y-5">
      {/* ================= 1. the week ================= */}
      <motion.section
        {...rise(0)}
        aria-label={`Training week of ${rangeLabel}`}
        className="pa-panel p-5 sm:p-6"
      >
        <SectionHeader
          eyebrow="Training"
          title={`Week of ${rangeLabel}`}
          subtitle={`${offsetLabel(weekOffset)}. Assign each day one of the days you keep below, then log what you actually lifted.`}
          icon={Dumbbell}
          action={
            <div className="flex w-full max-w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
              <div role="group" aria-label="Load unit" className="pa-seg h-9 shrink-0">
                {UNITS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setUnit(option)}
                    data-active={unit === option}
                    aria-pressed={unit === option}
                    className="pa-seg-btn pa-focus"
                  >
                    <span className="relative z-[1]">{option}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMonday(addDaysKey(monday, -7))}
                  aria-label="Show the previous week"
                  data-tip="Previous week"
                  className="pa-icon-btn pa-focus size-9"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.9} aria-hidden />
                </button>

                {isCurrentWeek ? (
                  <span className="pa-badge" data-tone="azure">
                    This week
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMonday(thisMonday)}
                    aria-label="Jump back to this week"
                    className="pa-btn pa-focus h-9 px-3 text-[12.5px]"
                  >
                    This week
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setMonday(addDaysKey(monday, 7))}
                  aria-label="Show the next week"
                  data-tip="Next week"
                  className="pa-icon-btn pa-focus size-9"
                >
                  <ChevronRight className="size-4" strokeWidth={1.9} aria-hidden />
                </button>
              </div>
            </div>
          }
        />

        <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-3">
          <StatTile
            label="Sessions"
            value={totals.sessions}
            suffix={totals.sessions === 1 ? 'day' : 'days'}
            hint={
              totals.sessions === 0
                ? 'Nothing written down this week yet'
                : `${totals.exercises} ${plural(totals.exercises, 'exercise', 'exercises')} in total`
            }
            icon={Dumbbell}
            tone={totals.sessions >= 3 ? 'green' : 'default'}
          />
          <StatTile
            label="Volume"
            value={formatVolume(totals.volume)}
            suffix={unit}
            /* Volume is the honest week-on-week number, and it is also the one
               most easily misread — bodyweight work weighs nothing. Say so
               here rather than letting the figure imply an easy week. */
            hint="Sets × reps × load, added up"
          />
          <StatTile
            label="Sets"
            value={totals.sets}
            hint={
              totals.exercises === 0
                ? 'Across every exercise'
                : `${totals.done} of ${totals.exercises} exercises ticked off`
            }
          />
        </div>
      </motion.section>

      {/* ================= 2. the seven days ================= */}
      {/* `items-start` so a rest day stays one line high instead of being
          stretched to match the four-exercise card beside it. */}
      <div
        role="group"
        aria-label={`Days, ${rangeLabel}`}
        className="grid items-start gap-3 sm:gap-4 lg:grid-cols-2"
      >
        {weekDays.map((day, index) => (
          <DayCard key={day} day={day} index={index + 1} today={today} unit={unit} />
        ))}
      </div>

      {/* ================= 3. the plan ================= */}
      <WorkoutPlanLibrary />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One day — a header, its exercises, and a way to add another.
 * ---------------------------------------------------------------------- */

interface DayCardProps {
  day: DayKey;
  /** Position in the week — drives the entrance stagger only. */
  index: number;
  today: DayKey;
  unit: LoadUnit;
}

function DayCard({ day, index, today, unit }: DayCardProps): JSX.Element {
  const { data, actions } = useAssistant();
  const reduce = useReducedMotion();

  const exercises = useMemo(() => exercisesForDay(data, day), [data, day]);
  const totals = useMemo(() => dayTraining(data, day), [data, day]);

  const isTodayCard = isToday(day, today);
  const isPast = isPastDay(day, today);
  const longLabel = formatKey(day, 'EEEE d MMMM');
  const name = data.workoutDays[day]?.name ?? '';

  const clearDay = (): void => {
    const removed = actions.clearWorkout(day);
    if (removed === 0) return;
    toast(`${longLabel} cleared`, {
      description: 'Pick another day for it, or leave it as rest. ⌘Z brings it back.',
    });
  };

  /* Says where the numbers came from, because that is the surprising part:
   * picking "Leg day" does not hand you the plan's original weights, it hands
   * you the ones you finished the last leg day on. */
  const handlePicked = useCallback(
    (planName: string, count: number, carriedFrom: DayKey | null): void => {
      toast.success(`${planName} laid out`, {
        description:
          carriedFrom === null
            ? `${count} ${plural(count, 'exercise', 'exercises')}, at the plan's starting loads.`
            : `${count} ${plural(count, 'exercise', 'exercises')}, at the loads from ${relativeDayLabel(carriedFrom, today).toLowerCase()}.`,
      });
    },
    [today],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      aria-label={`${longLabel}${name ? ` — ${name}` : ''}${isTodayCard ? ' (today)' : ''} — ${totals.exercises} ${plural(totals.exercises, 'exercise', 'exercises')}`}
      className="pa-day-col flex flex-col p-3.5 sm:p-4"
      data-today={isTodayCard ? 'true' : 'false'}
      data-past={isPast && totals.exercises === 0 ? 'true' : 'false'}
    >
      {/* ---- day header ---- */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <p className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase leading-none tracking-[0.14em] text-[color:var(--pa-faint)]">
            {weekdayShort(day)}
            {isTodayCard ? (
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-[color:var(--pa-azure)]"
                style={{ boxShadow: '0 0 0 3px var(--pa-accent-glow)' }}
              />
            ) : null}
          </p>
          <p className="pa-display shrink-0 text-[19px] leading-none">{dayNumber(day)}</p>

          {/* What the session IS — read, not written. The name belongs to the
              plan this day was assigned, so editing it here would let a day and
              the plan it came from disagree about what a leg day is called. */}
          {name ? (
            <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-none tracking-tight text-[color:var(--pa-navy)]">
              {name}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {totals.volume > 0 ? (
            <span className="pa-badge tabular-nums" data-tip="Sets × reps × load">
              {formatVolume(totals.volume)} {unit}
            </span>
          ) : null}
          {totals.exercises > 0 ? (
            <>
              <span
                className="pa-badge tabular-nums"
                data-tone={totals.done === totals.exercises ? 'green' : undefined}
              >
                {totals.done}/{totals.exercises}
              </span>
              {/* Un-assign. The only way to change what a day is: clear it and
                  pick again, which is one decision rather than a swap that has
                  to reconcile two exercise lists. */}
              <button
                type="button"
                onClick={clearDay}
                data-danger="true"
                aria-label={`Clear the session on ${longLabel}`}
                data-tip="Clear this day and pick again"
                className="pa-icon-btn pa-focus size-7"
              >
                <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* ---- the exercises ---- */}
      {exercises.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          <AnimatePresence initial={false}>
            {exercises.map((exercise) => (
              <ExerciseRow key={exercise.id} exercise={exercise} unit={unit} />
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="mt-3 text-[12.5px] leading-snug text-[color:var(--pa-faint)]">
          {isPast ? 'Rest day' : 'Rest day — or pick what this one is.'}
        </p>
      )}

      {/* ---- what kind of day is this? ----
          The only way a day gets filled. An assigned day offers nothing,
          because laying a second plan over the first would silently double it
          — clear it first, which is what the bin in the header is for. */}
      {exercises.length === 0 ? (
        <div className="mt-3">
          <PlanPicker day={day} onPicked={handlePicked} />
        </div>
      ) : null}
    </motion.section>
  );
}

/* -------------------------------------------------------------------------
 * One exercise — tick, name, sets × reps, load.
 *
 * The row is a grid rather than a flex line so that the counters stay in the
 * same two columns down the whole card. On a flex row every name of a
 * different length would push them somewhere new, and a column of numbers you
 * cannot scan down is not a tracker.
 * ---------------------------------------------------------------------- */

interface ExerciseRowProps {
  exercise: Exercise;
  unit: LoadUnit;
}

function ExerciseRow({ exercise, unit }: ExerciseRowProps): JSX.Element {
  const { actions } = useAssistant();
  const reduce = useReducedMotion();
  const done = exercise.completedAt !== null;

  return (
    <motion.li
      layout={false}
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.16 } }}
      transition={{ duration: 0.28, ease: HOUSE_EASE }}
      className="pa-row grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-2 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
      data-done={done ? 'true' : 'false'}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${exercise.name}" as not done` : `Complete "${exercise.name}"`}
        data-tip={done ? 'Mark as not done' : 'Done'}
        onClick={() => actions.toggleExercise(exercise.id)}
        className="pa-check"
        style={{ width: '1.05rem', height: '1.05rem', borderRadius: '0.45rem' }}
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
              <Check className="size-3" strokeWidth={3} aria-hidden />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>

      {/* The plan owns the name. What you change here is what you actually
          did — the numbers and the tick. */}
      <p
        className={clsx(
          'min-w-0 truncate text-[13px] leading-snug text-[color:var(--pa-navy)]',
          done && 'line-through opacity-55',
        )}
      >
        {exercise.name}
      </p>

      {/* Sets and reps sit under the name on a narrow card and beside it once
          there is room — hence the column span on the small breakpoint. */}
      <div className="col-start-2 flex items-center gap-1.5 [@media(pointer:coarse)]:gap-3 sm:col-start-auto">
        <NumberStepper
          value={exercise.sets}
          onChange={(sets) => actions.updateExercise(exercise.id, { sets })}
          label={`Sets for ${exercise.name}`}
          min={0}
          max={99}
          width={2}
          size="sm"
        />
        <span className="text-[11px] text-[color:var(--pa-faint)]" aria-hidden>
          ×
        </span>
        <NumberStepper
          value={exercise.reps}
          onChange={(reps) => actions.updateExercise(exercise.id, { reps })}
          label={`Reps for ${exercise.name}`}
          min={0}
          max={999}
          width={2}
          size="sm"
        />
      </div>

      <div className="col-start-2 sm:col-start-auto">
        <NumberStepper
          value={exercise.load}
          onChange={(load) => actions.updateExercise(exercise.id, { load })}
          label={`Load for ${exercise.name}`}
          step={LOAD_STEP[unit]}
          min={0}
          max={1000}
          precision={1}
          suffix={unit}
          width={4}
        />
      </div>

      {/* No per-row delete. An exercise you skipped is one you left unticked,
          which is the truer record; and the list belongs to the plan, so
          pruning it here would put the day and the plan out of step. */}
    </motion.li>
  );
}
