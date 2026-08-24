'use client';

/* ---------------------------------------------------------------------------
 * meal-library.tsx — the meals you keep, and the editor for one of them.
 *
 * Two pieces:
 *
 *   <MealLibrary>       the shelf. Every saved meal, its total, and one button
 *                       that puts a copy of it on the day you are looking at.
 *   <MealEditorDialog>  one meal opened up: its name, its ingredients, and
 *                       what each of them costs.
 *
 * WHY A COPY AND NOT A REFERENCE
 * ------------------------------
 * Logging a meal writes its ingredients onto the day. Editing the saved meal
 * afterwards changes what you will eat NEXT time and nothing about what you
 * already ate — a food log whose past silently rewrites itself is not a log.
 * The entry keeps `mealId` as provenance, which is what the use count reads,
 * but no number is ever fetched through it. See lib/types.ts.
 *
 * WHY THE EDITOR IS A DIALOG
 * --------------------------
 * A meal is a list inside a list. Expanded in place on the shelf it would push
 * every other card down the page, and the shelf is a grid — the reflow lands
 * differently depending on which column you opened. A dialog is one surface at
 * one size wherever it is opened from.
 * ------------------------------------------------------------------------- */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { BookMarked, CalendarPlus, Plus, Scale, Trash2, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';

import { capitaliseOnType } from '../../lib/capitalise';
import { relativeDayLabel } from '../../lib/dates';
import {
  allMeals,
  isWeighed,
  itemMacros,
  mealCalories,
  mealItems,
  mealMacros,
  mealUseCount,
} from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { DayKey, FoodItem, ID, Per100 } from '../../lib/types';

import {
  DIALOG_CONTENT,
  DIALOG_OVERLAY,
  DIALOG_SURFACE,
  PORTAL_SHELL,
} from '../shared/dialog-chrome';
import { InlineNumber, InlineText } from '../shared/inline-field';
import { MacroInline, gramsLabel } from '../shared/macro-line';
import { NumberStepper } from '../shared/number-stepper';
import { SectionHeader } from '../shared/section-header';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/* -------------------------------------------------------------------------
 * The shelf
 * ---------------------------------------------------------------------- */

export interface MealLibraryProps {
  /** The day an "Add" lands on — whichever one the food view is showing. */
  day: DayKey;
  today: DayKey;
}

export function MealLibrary({ day, today }: MealLibraryProps): JSX.Element {
  const { data, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [editing, setEditing] = useState<ID | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const meals = useMemo(() => allMeals(data), [data]);
  const dayLabel = relativeDayLabel(day, today);

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = draft.trim();
    if (name.length === 0) return;
    const meal = actions.addMeal({ name });
    setDraft('');
    // Straight into the editor: a meal with no ingredients is not yet a meal,
    // and the next thing anyone wants is to put them in.
    setEditing(meal.id);
  };

  const log = (mealId: ID, name: string): void => {
    const entry = actions.logMeal(mealId, day);
    if (!entry) return;
    toast.success(`${name} added to ${dayLabel.toLowerCase()}`, {
      description: `${entry.calories.toLocaleString()} kcal, ingredients and all.`,
    });
  };

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: reduce ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: HOUSE_EASE, delay: reduce ? 0 : 0.09 }}
        aria-label="Your meals"
        className="pa-panel p-5 sm:p-6"
      >
        <SectionHeader
          eyebrow="Kept"
          title="Your meals"
          subtitle="Build a meal once from its ingredients, then put it on any day — including the ones ahead, which is how you plan a shop."
          icon={BookMarked}
          action={
            meals.length > 0 ? (
              <span className="pa-badge tabular-nums">
                {meals.length} {plural(meals.length, 'meal', 'meals')}
              </span>
            ) : null
          }
        />

        {meals.length > 0 ? (
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {meals.map((meal) => {
                const kcal = mealCalories(meal);
                const used = mealUseCount(data, meal.id);
                return (
                  <motion.article
                    key={meal.id}
                    layout={false}
                    initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.16 } }}
                    transition={{ duration: 0.28, ease: HOUSE_EASE }}
                    className="pa-tile flex flex-col gap-3 p-3.5"
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(meal.id)}
                      className="pa-focus min-w-0 rounded-[0.6rem] text-left"
                      aria-label={`Edit ${meal.name}`}
                    >
                      <p className="truncate text-[13.5px] font-medium leading-snug tracking-tight text-[color:var(--pa-navy)]">
                        {meal.name}
                      </p>
                      <p className="mt-1 flex items-baseline gap-1.5 text-[11.5px] leading-none text-[color:var(--pa-faint)]">
                        <span className="text-[15px] font-semibold tabular-nums text-[color:var(--pa-muted)]">
                          {kcal.toLocaleString()}
                        </span>
                        kcal
                        <span aria-hidden>·</span>
                        {meal.items.length} {plural(meal.items.length, 'ingredient', 'ingredients')}
                        {used > 0 ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>
                              used {used}×
                            </span>
                          </>
                        ) : null}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => log(meal.id, meal.name)}
                      className="pa-btn pa-focus h-8 w-full gap-1.5 text-[12px]"
                      data-tip={`Put ${meal.name} on ${dayLabel.toLowerCase()}`}
                    >
                      <CalendarPlus className="size-3.5" strokeWidth={1.9} aria-hidden />
                      Add to {dayLabel.toLowerCase()}
                    </button>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <p className="mt-5 max-w-[62ch] text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
            Nothing kept yet. Name a meal below and put its ingredients in — after that it is one
            click onto any day, and you never type it out again.
          </p>
        )}

        {/* ---- name a new one ---- */}
        <form onSubmit={create} className="pa-capture mt-4 flex items-center gap-2 p-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(capitaliseOnType(event))}
            placeholder="Name a meal — chicken and rice, overnight oats…"
            aria-label="Name a new meal"
            className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[13.5px] leading-snug tracking-tight text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
          />
          <button
            type="submit"
            disabled={draft.trim().length === 0}
            aria-label="Create this meal"
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

      <MealEditorDialog mealId={editing} onOpenChange={(open) => (open ? null : setEditing(null))} />
    </>
  );
}

/* -------------------------------------------------------------------------
 * One meal, opened up
 * ---------------------------------------------------------------------- */

export interface MealEditorDialogProps {
  /** `null` closes it. */
  mealId: ID | null;
  onOpenChange: (open: boolean) => void;
}

export function MealEditorDialog({ mealId, onOpenChange }: MealEditorDialogProps): JSX.Element {
  const { data, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [nameDraft, setNameDraft] = useState('');
  const [kcalDraft, setKcalDraft] = useState('');
  const firstRef = useRef<HTMLInputElement | null>(null);

  /* One open at a time, and closed again whenever the dialog changes meal. The
   * facts panel is four more fields on an already busy row; two of them open
   * together turns a five-line list into a page you have to scroll. */
  const [openFacts, setOpenFacts] = useState<ID | null>(null);
  useEffect(() => setOpenFacts(null), [mealId]);

  const meal = mealId === null ? null : data.meals.find((m) => m.id === mealId) ?? null;
  const items = meal ? mealItems(meal) : [];
  const total = meal ? mealCalories(meal) : 0;
  const macros = meal ? mealMacros(meal) : null;

  const addItem = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!meal) return;
    const name = nameDraft.trim();
    if (name.length === 0) return;
    const calories = Number(kcalDraft.replace(/[\s,]/g, ''));
    actions.addMealItem(meal.id, { name, calories: Number.isFinite(calories) ? calories : 0 });
    setNameDraft('');
    setKcalDraft('');
    firstRef.current?.focus();
  };

  const remove = (): void => {
    if (!meal) return;
    actions.deleteMeal(meal.id);
    onOpenChange(false);
    toast(`${meal.name} deleted`, {
      description: 'Days already logged from it keep everything they were given.',
    });
  };

  return (
    <Dialog open={mealId !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={DIALOG_OVERLAY}
        className={clsx('pa-portal', DIALOG_CONTENT, 'sm:max-w-[560px]')}
      >
        <div className="assistant-shell" style={PORTAL_SHELL}>
          <div className={DIALOG_SURFACE}>
            {meal ? (
              <>
                <DialogHeader className="relative shrink-0 gap-0 border-b border-[color:var(--pa-line)] px-5 pb-5 pt-5 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="pa-eyebrow mb-1.5 leading-none">Meal</p>
                      {/* The title IS the field. There is no separate edit
                          mode for a name that is one line long. */}
                      <DialogTitle asChild>
                        <h2 className="pa-title text-[17px] leading-snug">
                          <InlineText
                            value={meal.name}
                            onCommit={(name) => actions.renameMeal(meal.id, name)}
                            label="Meal name"
                            className="w-full text-[17px] font-medium leading-snug tracking-tight"
                          />
                        </h2>
                      </DialogTitle>
                      <DialogDescription className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
                        {items.length === 0
                          ? 'Put the ingredients in and what each of them costs.'
                          : `${items.length} ${plural(items.length, 'ingredient', 'ingredients')}, ${total.toLocaleString()} kcal in total.`}
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
                          <IngredientRow
                            key={item.id}
                            mealId={meal.id}
                            item={item}
                            open={openFacts === item.id}
                            onToggleFacts={() =>
                              setOpenFacts((current) => (current === item.id ? null : item.id))
                            }
                            reduce={reduce === true}
                          />
                        ))}
                      </AnimatePresence>
                    </ul>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
                      No ingredients yet. The total is their sum, so this meal is worth nothing
                      until something goes in it.
                    </p>
                  )}

                  <form onSubmit={addItem} className="pa-capture mt-4 flex items-center gap-2 p-2">
                    <input
                      ref={firstRef}
                      value={nameDraft}
                      onChange={(event) => setNameDraft(capitaliseOnType(event))}
                      placeholder="Ingredient"
                      aria-label="Ingredient name"
                      className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[13.5px] leading-snug tracking-tight text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
                    />
                    <span className="pa-capture-slot shrink-0">
                      <input
                        value={kcalDraft}
                        onChange={(event) => setKcalDraft(event.target.value)}
                        inputMode="numeric"
                        placeholder="—"
                        aria-label="Ingredient calories"
                        className="w-[6ch] border-0 bg-transparent text-right text-[13.5px] font-medium tabular-nums text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
                      />
                      <span className="text-[11px] text-[color:var(--pa-faint)]" aria-hidden>
                        kcal
                      </span>
                    </span>
                    <button
                      type="submit"
                      disabled={nameDraft.trim().length === 0}
                      aria-label="Add this ingredient"
                      className={clsx(
                        'pa-cta pa-focus h-9 shrink-0 px-3.5 text-[13px]',
                        nameDraft.trim().length === 0 && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      Add
                    </button>
                  </form>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--pa-line)] px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <p className="flex items-baseline gap-1.5 text-[12px] text-[color:var(--pa-faint)]">
                      Total
                      <span className="text-[17px] font-semibold tabular-nums text-[color:var(--pa-navy)]">
                        {total.toLocaleString()}
                      </span>
                      kcal
                    </p>
                    {/* Only when something in the meal was actually weighed —
                        an empty "0 P · 0 F · 0 C" is a measurement nobody took. */}
                    {macros ? (
                      <MacroInline
                        totals={macros}
                        className="mt-1 text-[11.5px] leading-none text-[color:var(--pa-muted)]"
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={remove}
                    data-danger="true"
                    className="pa-icon-btn pa-focus h-9 shrink-0 gap-1.5 whitespace-nowrap px-3 text-[12.5px]"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
                    Delete meal
                  </button>
                </div>
              </>
            ) : (
              <div className="p-6">
                <DialogTitle className="pa-title text-[15px]">Meal unavailable</DialogTitle>
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
 * One ingredient
 *
 * THE TWO STATES OF THE CALORIE FIGURE
 * ------------------------------------
 * Before an ingredient has been weighed its kcal is a field: you know the
 * number, you type it, and that is the whole of what the app knows. Once it has
 * a weight and the facts off the packet, the kcal is arithmetic — and it is
 * rendered as text, not as a disabled input. A greyed-out box that still looks
 * like a box invites the click it is about to refuse; a plain figure with the
 * sum in its tooltip says what happened.
 *
 * WHY THE FACTS ARE BEHIND A TOGGLE
 * ---------------------------------
 * Per 100 g is four more numbers, and they are entered ONCE per ingredient and
 * then never touched again. The weight is the number that changes — a bit more
 * rice this time — so that is the one that lives on the row, as a counter, and
 * the four that do not change fold away behind the scale button.
 * ---------------------------------------------------------------------- */

const NO_FACTS: Per100 = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

const FACTS: readonly { key: keyof Per100; label: string; max: number }[] = [
  // kcal first: it is the one that decides whether the row is weighed at all.
  { key: 'kcal', label: 'kcal', max: 900 },
  { key: 'protein', label: 'protein', max: 100 },
  { key: 'fat', label: 'fat', max: 100 },
  { key: 'carbs', label: 'carbs', max: 100 },
];

interface IngredientRowProps {
  mealId: ID;
  item: FoodItem;
  open: boolean;
  onToggleFacts: () => void;
  reduce: boolean;
}

function IngredientRow({
  mealId,
  item,
  open,
  onToggleFacts,
  reduce,
}: IngredientRowProps): JSX.Element {
  const { actions } = useAssistant();

  const weighed = isWeighed(item);
  const macros = itemMacros(item);
  const facts = item.per100 ?? NO_FACTS;
  const showGrams = item.grams !== undefined || open;

  const patch = (next: Parameters<typeof actions.updateMealItem>[2]): void => {
    actions.updateMealItem(mealId, item.id, next);
  };

  return (
    <motion.li
      layout={false}
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.16 } }}
      transition={{ duration: 0.24, ease: HOUSE_EASE }}
      className="pa-row pa-row-hover group px-3 py-2.5"
    >
      {/* `basis-full sm:basis-0` puts the name on its own line in the narrow
          dialog and back beside the numbers once there is room for both. Five
          controls do not fit across 287px, and shrinking the name to fit is how
          you get a field two characters wide. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <InlineText
          value={item.name}
          onCommit={(name) => patch({ name })}
          label="Ingredient"
          className="min-w-0 flex-1 basis-full text-[13.5px] leading-snug sm:basis-0"
        />

        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-2 sm:flex-nowrap sm:gap-2.5">
          {/* Only once there is a weight to show, or while the panel that asks
              for one is open. A counter resting on "0 g" against every plain
              ingredient is not an empty field — it is the row stating that the
              broccoli weighs nothing. */}
          {showGrams ? (
            <NumberStepper
              value={item.grams ?? 0}
              onChange={(grams) => patch({ grams })}
              step={10}
              max={10_000}
              suffix="g"
              width={4}
              size="sm"
              label={`Grams of ${item.name}`}
              className="shrink-0"
            />
          ) : null}

          {/* Both branches occupy the same width so the column lines up down
              the list whichever state each row happens to be in. */}
          <span className="flex w-auto shrink-0 justify-end sm:w-[4.75rem]">
            {weighed ? (
              <span
                className="pa-ghost-num text-[14.5px] font-medium tabular-nums text-[color:var(--pa-navy)]"
                data-tip={`${gramsLabel(item.grams ?? 0)} g × ${gramsLabel(facts.kcal)} kcal per 100 g`}
              >
                <span>{item.calories.toLocaleString()}</span>
                <span className="pa-ghost-suffix">kcal</span>
              </span>
            ) : (
              <InlineNumber
                value={item.calories}
                onCommit={(calories) => patch({ calories })}
                max={100_000}
                suffix="kcal"
                label={`Calories in ${item.name}`}
                className="pa-ghost-slot text-[14.5px] font-medium tabular-nums text-[color:var(--pa-navy)]"
              />
            )}
          </span>

          <button
            type="button"
            onClick={onToggleFacts}
            aria-expanded={open}
            data-active={weighed ? 'true' : 'false'}
            aria-label={`Per 100 g facts for ${item.name}`}
            data-tip={weighed ? 'Edit the facts per 100 g' : 'Add the facts per 100 g'}
            className="pa-icon-btn pa-focus size-7 shrink-0 data-[active=true]:text-[color:var(--pa-ink-accent)]"
          >
            <Scale className="size-3.5" strokeWidth={1.9} aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => actions.deleteMealItem(mealId, item.id)}
            data-danger="true"
            aria-label={`Remove ${item.name}`}
            data-tip="Remove"
            className="pa-icon-btn pa-focus size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      </div>

      {/* Closed and weighed: what the row works out to, in one faint line. */}
      {!open && macros ? (
        <p className="mt-1.5 text-[11.5px] leading-none text-[color:var(--pa-faint)]">
          <span className="tabular-nums">{gramsLabel(facts.kcal)}</span> kcal/100 g
          <span aria-hidden> · </span>
          <span className="tabular-nums">{gramsLabel(macros.protein)}</span> P
          <span aria-hidden> · </span>
          <span className="tabular-nums">{gramsLabel(macros.fat)}</span> F
          <span aria-hidden> · </span>
          <span className="tabular-nums">{gramsLabel(macros.carbs)}</span> C
        </p>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="facts"
            initial={{ opacity: 0, height: reduce ? 'auto' : 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: reduce ? 'auto' : 0 }}
            transition={{ duration: 0.22, ease: HOUSE_EASE }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 border-t border-[color:var(--pa-line-soft)] pt-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="pa-eyebrow leading-none">Per 100 g</p>
                {weighed ? (
                  <button
                    type="button"
                    /* Clears the facts and the weight together — half of a
                       measurement is not a measurement. The calories stay at
                       whatever they last worked out to, because that is still
                       the best account anyone has of what went in, and the
                       field goes back to being typeable. */
                    onClick={() => patch({ per100: null, grams: null })}
                    className="pa-icon-btn pa-focus h-7 px-2 text-[11.5px]"
                    data-tip="Forget the facts and keep the calories"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                {FACTS.map((fact) => (
                  <span key={fact.key} className="flex items-baseline gap-1.5">
                    <InlineNumber
                      value={facts[fact.key]}
                      onCommit={(next) => patch({ per100: { ...facts, [fact.key]: next } })}
                      max={fact.max}
                      precision={1}
                      label={`${item.name} — ${fact.label} per 100 g`}
                      className="pa-ghost-slot text-[13.5px] font-medium tabular-nums text-[color:var(--pa-navy)]"
                    />
                    <span className="text-[11px] leading-none text-[color:var(--pa-faint)]">
                      {fact.label}
                    </span>
                  </span>
                ))}
              </div>

              <p className="mt-2.5 text-[11.5px] leading-relaxed text-[color:var(--pa-muted)]">
                {weighed
                  ? 'Copied off the packet. The calories on the row are this multiplied by the weight, so change either one and they follow.'
                  : 'Put the calories per 100 g in and set the weight beside the name — the calories for this ingredient are worked out from the two.'}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}
