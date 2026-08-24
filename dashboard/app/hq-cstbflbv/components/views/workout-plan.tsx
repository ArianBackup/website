'use client';

/* ---------------------------------------------------------------------------
 * workout-plan.tsx — the muscle-group days you keep, and the editor for one.
 *
 *   <WorkoutPlanLibrary>  the shelf: Leg day, Push, Pull, each with what is in
 *                         it. Applying one happens on the BOARD, not here.
 *   <PlanEditorDialog>    one day opened up: its exercises, sets, reps, load.
 *
 * WHY APPLYING HAPPENS ON THE DAY AND NOT ON THE CARD
 * ---------------------------------------------------
 * The meal shelf has an "Add to today" on every card, because the food view is
 * looking at exactly one day and there is no ambiguity about where a meal would
 * land. This view shows seven days at once, so a button here would have to ask
 * "which one?" first. Instead the choice lives where the answer already is: an
 * empty day on the board offers the plans as chips, and picking one lays it out.
 * The card is for writing the plan down; the board is for using it.
 *
 * WHAT A PLAN'S LOADS ARE FOR
 * ---------------------------
 * They are the numbers you START at, and they are only used the first time.
 * After that, applying a plan carries forward what you actually lifted the last
 * time you ran it — see `applyPlan` in store.tsx. So the figures on this shelf
 * age into a record of where a lift began rather than what it is now, which is
 * why the card leads with sets and exercises rather than with weight.
 * ------------------------------------------------------------------------- */

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { ClipboardList, Dumbbell, Plus, Trash2, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';

import { capitaliseOnType } from '../../lib/capitalise';
import { allPlans, planExercises, planTotals, planUseCount } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { ID, LoadUnit } from '../../lib/types';

import {
  DIALOG_CONTENT,
  DIALOG_OVERLAY,
  DIALOG_SURFACE,
  PORTAL_SHELL,
} from '../shared/dialog-chrome';
import { InlineText } from '../shared/inline-field';
import { NumberStepper } from '../shared/number-stepper';
import { SectionHeader } from '../shared/section-header';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** Matches the board's stepper: one pair of the smallest plates on the rack. */
const LOAD_STEP: Record<LoadUnit, number> = { kg: 2.5, lb: 5 };

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/* -------------------------------------------------------------------------
 * The shelf
 * ---------------------------------------------------------------------- */

export function WorkoutPlanLibrary(): JSX.Element {
  const { data, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [editing, setEditing] = useState<ID | null>(null);
  const [draft, setDraft] = useState('');

  const plans = useMemo(() => allPlans(data), [data]);
  const unit = data.settings.loadUnit;

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = draft.trim();
    if (name.length === 0) return;
    const plan = actions.addPlan({ name });
    setDraft('');
    // Straight into the editor: a day with no exercises in it is not yet a day.
    setEditing(plan.id);
  };

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.09 }}
        aria-label="Workout plan"
        className="pa-panel p-5 sm:p-6"
      >
        <SectionHeader
          eyebrow="Kept"
          title="Workout plan"
          subtitle="Write down what a leg day is once. After that a day on the board becomes one by picking it — and it arrives with the weights you finished on last time."
          icon={ClipboardList}
          action={
            plans.length > 0 ? (
              <span className="pa-badge tabular-nums">
                {plans.length} {plural(plans.length, 'day', 'days')}
              </span>
            ) : null
          }
        />

        {plans.length > 0 ? (
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {plans.map((plan) => {
                const totals = planTotals(plan);
                const used = planUseCount(data, plan.id);
                const items = planExercises(plan);
                return (
                  <motion.article
                    key={plan.id}
                    layout={false}
                    initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.16 } }}
                    transition={{ duration: 0.28, ease: HOUSE_EASE }}
                    className="pa-tile p-3.5"
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(plan.id)}
                      className="pa-focus w-full min-w-0 rounded-[0.6rem] text-left"
                      aria-label={`Edit ${plan.name}`}
                    >
                      <p className="truncate text-[13.5px] font-medium leading-snug tracking-tight text-[color:var(--pa-navy)]">
                        {plan.name}
                      </p>
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] leading-none text-[color:var(--pa-faint)]">
                        <span className="text-[15px] font-semibold tabular-nums text-[color:var(--pa-muted)]">
                          {items.length}
                        </span>
                        {plural(items.length, 'exercise', 'exercises')}
                        <span aria-hidden>·</span>
                        {totals.sets} {plural(totals.sets, 'set', 'sets')}
                        {used > 0 ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>run {used}×</span>
                          </>
                        ) : null}
                      </p>

                      {/* The exercises themselves, so the card answers "what is
                          a leg day again?" without being opened. */}
                      {items.length > 0 ? (
                        <p className="mt-2.5 line-clamp-2 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                          {items.map((item) => item.name).join(' · ')}
                        </p>
                      ) : (
                        <p className="mt-2.5 text-[11.5px] leading-relaxed text-[color:var(--pa-faint)]">
                          Empty — open it and put the exercises in.
                        </p>
                      )}
                    </button>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <p className="mt-5 max-w-[62ch] text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
            Nothing kept yet. Name a day below — Leg day, Push, Pull — and put its exercises in.
            After that every empty day on the board offers it as a chip.
          </p>
        )}

        <form onSubmit={create} className="pa-capture mt-4 flex items-center gap-2 p-2">
          <input
            value={draft}
            onChange={(event) => setDraft(capitaliseOnType(event))}
            placeholder="Name a day — leg day, push, pull…"
            aria-label="Name a new workout day"
            className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[13.5px] leading-snug tracking-tight text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
          />
          <button
            type="submit"
            disabled={draft.trim().length === 0}
            aria-label="Create this workout day"
            className={clsx(
              'pa-cta pa-focus h-9 shrink-0 gap-1.5 px-3.5 text-[13px]',
              draft.trim().length === 0 && 'cursor-not-allowed opacity-40',
            )}
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden />
            Create
          </button>
        </form>
      </motion.section>

      <PlanEditorDialog
        planId={editing}
        unit={unit}
        onOpenChange={(open) => (open ? null : setEditing(null))}
      />
    </>
  );
}

/* -------------------------------------------------------------------------
 * One day, opened up
 * ---------------------------------------------------------------------- */

export interface PlanEditorDialogProps {
  /** `null` closes it. */
  planId: ID | null;
  unit: LoadUnit;
  onOpenChange: (open: boolean) => void;
}

export function PlanEditorDialog({
  planId,
  unit,
  onOpenChange,
}: PlanEditorDialogProps): JSX.Element {
  const { data, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [draft, setDraft] = useState('');
  const addRef = useRef<HTMLInputElement | null>(null);

  const plan = planId === null ? null : data.workoutPlans.find((p) => p.id === planId) ?? null;
  const items = plan ? planExercises(plan) : [];
  const totals = plan ? planTotals(plan) : { sets: 0, volume: 0 };

  const addItem = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!plan) return;
    const name = draft.trim();
    if (name.length === 0) return;
    actions.addPlanExercise(plan.id, { name });
    setDraft('');
    addRef.current?.focus();
  };

  const remove = (): void => {
    if (!plan) return;
    actions.deletePlan(plan.id);
    onOpenChange(false);
    toast(`${plan.name} deleted`, {
      description: 'Days already laid out from it keep every exercise they were given.',
    });
  };

  return (
    <Dialog open={planId !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={DIALOG_OVERLAY}
        className={clsx('pa-portal', DIALOG_CONTENT, 'sm:max-w-[620px]')}
      >
        <div className="assistant-shell" style={PORTAL_SHELL}>
          <div className={DIALOG_SURFACE}>
            {plan ? (
              <>
                <DialogHeader className="relative shrink-0 gap-0 border-b border-[color:var(--pa-line)] px-5 pb-5 pt-5 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="pa-eyebrow mb-1.5 leading-none">Workout plan</p>
                      <DialogTitle asChild>
                        <h2 className="pa-title text-[17px] leading-snug">
                          <InlineText
                            value={plan.name}
                            onCommit={(name) => actions.renamePlan(plan.id, name)}
                            label="Workout day name"
                            className="w-full text-[17px] font-medium leading-snug tracking-tight"
                          />
                        </h2>
                      </DialogTitle>
                      <DialogDescription className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
                        {items.length === 0
                          ? 'Put the exercises in. Sets, reps and a starting load each.'
                          : `${items.length} ${plural(items.length, 'exercise', 'exercises')}, ${totals.sets} sets. These loads are where each lift starts — a day picks up from what you last did.`}
                      </DialogDescription>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      aria-label="Close"
                      className="pa-icon-btn pa-focus size-9 shrink-0"
                    >
                      <X className="size-4" strokeWidth={1.9} aria-hidden />
                    </button>
                  </div>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                  {items.length > 0 ? (
                    <ul className="space-y-1.5">
                      <AnimatePresence initial={false}>
                        {items.map((item) => (
                          <motion.li
                            key={item.id}
                            layout={false}
                            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.16 } }}
                            transition={{ duration: 0.24, ease: HOUSE_EASE }}
                            className="pa-row pa-row-hover group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                          >
                            <InlineText
                              value={item.name}
                              onCommit={(name) =>
                                actions.updatePlanExercise(plan.id, item.id, { name })
                              }
                              label="Exercise"
                              className="min-w-0 text-[13.5px] leading-snug"
                            />

                            <div className="col-start-1 flex items-center gap-1.5 sm:col-start-auto">
                              <NumberStepper
                                value={item.sets}
                                onChange={(sets) =>
                                  actions.updatePlanExercise(plan.id, item.id, { sets })
                                }
                                label={`Sets for ${item.name}`}
                                min={0}
                                max={99}
                                width={2}
                                size="sm"
                              />
                              <span className="text-[11px] text-[color:var(--pa-faint)]" aria-hidden>
                                ×
                              </span>
                              <NumberStepper
                                value={item.reps}
                                onChange={(reps) =>
                                  actions.updatePlanExercise(plan.id, item.id, { reps })
                                }
                                label={`Reps for ${item.name}`}
                                min={0}
                                max={999}
                                width={2}
                                size="sm"
                              />
                            </div>

                            <div className="col-start-1 sm:col-start-auto">
                              <NumberStepper
                                value={item.load}
                                onChange={(load) =>
                                  actions.updatePlanExercise(plan.id, item.id, { load })
                                }
                                label={`Starting load for ${item.name}`}
                                step={LOAD_STEP[unit]}
                                min={0}
                                max={1000}
                                precision={1}
                                suffix={unit}
                                width={4}
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => actions.deletePlanExercise(plan.id, item.id)}
                              data-danger="true"
                              aria-label={`Remove ${item.name}`}
                              data-tip="Remove"
                              className="pa-icon-btn pa-focus col-start-2 size-7 justify-self-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:col-start-auto [@media(pointer:coarse)]:opacity-100"
                            >
                              <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
                            </button>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
                      No exercises yet. Until there are, picking this day on the board would lay
                      out nothing.
                    </p>
                  )}

                  <form onSubmit={addItem} className="pa-capture mt-4 flex items-center gap-2 p-2">
                    <input
                      ref={addRef}
                      value={draft}
                      onChange={(event) => setDraft(capitaliseOnType(event))}
                      placeholder="Add an exercise…"
                      aria-label="Exercise name"
                      className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[13.5px] leading-snug tracking-tight text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
                    />
                    <button
                      type="submit"
                      disabled={draft.trim().length === 0}
                      aria-label="Add this exercise"
                      className={clsx(
                        'pa-cta pa-focus h-9 shrink-0 px-3.5 text-[13px]',
                        draft.trim().length === 0 && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      Add
                    </button>
                  </form>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--pa-line)] px-5 py-4 sm:px-6">
                  <p className="flex items-baseline gap-1.5 text-[12px] text-[color:var(--pa-faint)]">
                    <Dumbbell
                      className="size-3.5 self-center text-[color:var(--pa-muted)]"
                      strokeWidth={1.9}
                      aria-hidden
                    />
                    <span className="text-[17px] font-semibold tabular-nums text-[color:var(--pa-navy)]">
                      {totals.sets}
                    </span>
                    {plural(totals.sets, 'set', 'sets')} in this day
                  </p>
                  <button
                    type="button"
                    onClick={remove}
                    data-danger="true"
                    className="pa-icon-btn pa-focus h-9 gap-1.5 px-3 text-[12.5px]"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
                    Delete day
                  </button>
                </div>
              </>
            ) : (
              <div className="p-6">
                <DialogTitle className="pa-title text-[15px]">Day unavailable</DialogTitle>
                <DialogDescription className="mt-2 text-[13px] text-[color:var(--pa-muted)]">
                  It was deleted while this was open.
                </DialogDescription>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------
 * The chips an empty day offers
 * ---------------------------------------------------------------------- */

export interface PlanPickerProps {
  day: string;
  /** Optional lead-in before the chips. Omitted where the copy above says it. */
  label?: string;
  onPicked: (planName: string, count: number, carriedFrom: string | null) => void;
}

/**
 * The whole point of the feature, in one row: an empty day lists the days you
 * have written down, and one tap becomes one of them. It is also the ONLY way
 * a day gets filled — there is no typing exercises straight onto the board.
 *
 * A menu would be one click more and would hide the names until opened, which
 * is exactly the information that makes the choice — with three or four plans
 * the chips ARE the menu, already open.
 */
export function PlanPicker({ day, label, onPicked }: PlanPickerProps): JSX.Element | null {
  const { data, actions } = useAssistant();
  const plans = useMemo(() => allPlans(data).filter((p) => p.items.length > 0), [data]);

  if (plans.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {label ? (
        <span className="shrink-0 text-[11px] text-[color:var(--pa-faint)]">{label}</span>
      ) : null}
      {plans.map((plan) => (
        <button
          key={plan.id}
          type="button"
          onClick={() => {
            // Read the source day BEFORE applying, or the day we just wrote is
            // the one it finds.
            let previous: string | null = null;
            for (const [key, value] of Object.entries(data.workoutDays)) {
              if (value.planId !== plan.id || key >= day) continue;
              if (previous === null || key > previous) previous = key;
            }
            const count = actions.applyPlan(plan.id, day);
            if (count > 0) onPicked(plan.name, count, previous);
          }}
          className="pa-btn pa-focus h-7 shrink-0 px-2.5 text-[11.5px]"
          data-tip={`Lay ${plan.name} out on this day`}
        >
          {plan.name}
        </button>
      ))}
    </div>
  );
}
