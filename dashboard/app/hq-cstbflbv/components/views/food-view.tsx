'use client';

/* ---------------------------------------------------------------------------
 * food-view.tsx — what you ate, and what is left.
 *
 *   1. the four numbers — target, eaten, left, week average
 *   2. the week as seven bars, which is also how you change day
 *   3. the day's entries, and one line to add another
 *   4. the meal shelf — see meal-library.tsx
 *
 * PLANNING IS THE SAME SURFACE AS LOGGING
 * ---------------------------------------
 * There is no separate "plan" mode. The day arrows and the week strip reach
 * forwards as readily as back, and putting a meal on Thursday is the same
 * gesture as putting one on today — so a future day IS the prep list, written
 * in the same place and in the same shape as the record of a past one.
 *
 * WHY THIS IS DAY-FIRST AND TRAINING IS WEEK-FIRST
 * ------------------------------------------------
 * They are not the same job. A week of lifting is PLANNED — you write Monday's
 * session before Monday — so that view shows seven days at once and lets you
 * fill any of them. Food is LOGGED, after the fact and usually the same day, so
 * this one puts a single day in front of you and keeps the week to a strip you
 * can glance at or click into.
 *
 * WHICH NUMBERS CAN BE EDITED, AND WHY IT IS ONLY ONE OF THEM
 * -----------------------------------------------------------
 * The TARGET is an input: it is a decision, and nothing else can tell us what
 * it should be. Eaten, left and the average are arithmetic on the entries
 * below, and making them writable would mean holding two contradictory answers
 * to the same question — a total that says 1,800 over a list that adds to 2,300
 * is not a feature, it is a bug you cannot see.
 *
 * Nothing is lost by that. Every entry's name and figure IS editable, so a day
 * you do not want to itemise is one line: "Dinner out — 900". Same keystrokes
 * as overwriting a total, and the week average still means something afterwards.
 * ------------------------------------------------------------------------- */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  BookmarkPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Flame,
  type LucideIcon,
  Target,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';

import {
  addDaysKey,
  dayNumber,
  formatKey,
  isFutureDay,
  isToday,
  relativeDayLabel,
  weekStartKey,
  weekdayShort,
} from '../../lib/dates';
import { capitaliseOnType } from '../../lib/capitalise';
import { calorieDay, calorieWeek, dayMacros, foodForDay } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { DayKey } from '../../lib/types';

import { InlineNumber, InlineText } from '../shared/inline-field';
import { MacroStrip, gramsLabel } from '../shared/macro-line';
import { Meter } from '../shared/meter';
import { SectionHeader } from '../shared/section-header';
import { MealLibrary } from './meal-library';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * How tall a day's bar can grow before it is simply "full".
 *
 * The bar is a glance, not a gauge: letting a 4,000 kcal Saturday scale the
 * whole strip would squash every ordinary day into a stub. Anything at or over
 * target fills the track and changes colour instead.
 */
function barHeight(total: number, target: number): number {
  if (target <= 0 || total <= 0) return 0;
  return Math.min(1, total / target);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function FoodView(): JSX.Element {
  const { data, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  const [day, setDay] = useState<DayKey>(today);

  const entries = useMemo(() => foodForDay(data, day), [data, day]);
  const stats = useMemo(() => calorieDay(data, day), [data, day]);
  const week = useMemo(() => calorieWeek(data, weekStartKey(day)), [data, day]);
  const macros = useMemo(() => dayMacros(data, day), [data, day]);

  const [nameDraft, setNameDraft] = useState('');
  const [kcalDraft, setKcalDraft] = useState('');
  const nameRef = useRef<HTMLInputElement | null>(null);

  const isTodayView = isToday(day, today);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = nameDraft.trim();
    if (name.length === 0) return;
    const calories = Number(kcalDraft.replace(/[\s,]/g, ''));
    actions.addFood({
      date: day,
      name,
      calories: Number.isFinite(calories) ? calories : 0,
    });
    setNameDraft('');
    setKcalDraft('');
    // A day is logged in one sitting, so the caret goes back to the start.
    nameRef.current?.focus();
  };

  const saveAsMeal = useCallback(
    (entryId: string, name: string): void => {
      const meal = actions.saveEntryAsMeal(entryId);
      if (!meal) return;
      toast.success(`${name} saved`, {
        description: 'It is on the shelf below — open it to break it into ingredients.',
      });
    },
    [actions],
  );

  const rise = useCallback(
    (index: number) => ({
      initial: { opacity: 0, y: reduce ? 0 : 12 },
      animate: { opacity: 1, y: 0 },
      transition: {
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.045, 0.3),
      },
    }),
    [reduce],
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ================= 1. the numbers ================= */}
      <motion.section {...rise(0)} aria-label="Intake" className="pa-panel p-5 sm:p-6">
        <SectionHeader
          eyebrow="Food"
          title={isTodayView ? 'Today' : formatKey(day, 'EEEE d MMMM')}
          subtitle="Log what you ate. The target is yours to set — everything beside it is counted from the list below."
          icon={UtensilsCrossed}
          action={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDay(addDaysKey(day, -1))}
                aria-label="Show the previous day"
                data-tip="Previous day"
                className="pa-icon-btn pa-focus size-9"
              >
                <ChevronLeft className="size-4" strokeWidth={1.9} aria-hidden />
              </button>

              {isTodayView ? (
                <span className="pa-badge" data-tone="azure">
                  Today
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDay(today)}
                  aria-label="Jump back to today"
                  className="pa-btn pa-focus h-9 px-3 text-[12.5px]"
                >
                  Today
                </button>
              )}

              <button
                type="button"
                onClick={() => setDay(addDaysKey(day, 1))}
                aria-label="Show the next day"
                data-tip="Next day"
                className="pa-icon-btn pa-focus size-9"
              >
                <ChevronRight className="size-4" strokeWidth={1.9} aria-hidden />
              </button>
            </div>
          }
        />

        {/* The four figures. The first is a field; the other three are sums. */}
        <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-2 lg:grid-cols-4">
          {/* The unit rides on the tile, not inside the field — so all four
              figures put "kcal" in exactly the same place and the editable one
              is not marked out by its own punctuation. */}
          <FigureTile
            label="Daily target"
            icon={Target}
            suffix="kcal"
            editable
            value={
              <InlineNumber
                value={stats.target}
                onCommit={actions.setCalorieTarget}
                min={1}
                max={20_000}
                label="Daily calorie target"
                className="pa-stat text-[1.6rem] tabular-nums"
              />
            }
            hint="Click to change"
          />

          <FigureTile
            label="Eaten"
            icon={UtensilsCrossed}
            value={
              <span className="pa-stat text-[1.6rem] tabular-nums">
                {stats.eaten.toLocaleString()}
              </span>
            }
            suffix="kcal"
            hint={
              stats.entries === 0
                ? 'Nothing logged yet'
                : `${stats.entries} ${plural(stats.entries, 'item', 'items')}`
            }
          />

          <FigureTile
            label={stats.over ? 'Over by' : 'Left'}
            icon={Flame}
            tone={stats.over ? 'amber' : 'green'}
            value={
              <span className="pa-stat text-[1.6rem] tabular-nums">
                {Math.abs(stats.left).toLocaleString()}
              </span>
            }
            suffix="kcal"
            hint={stats.over ? 'Past the target for the day' : 'Target less what you have eaten'}
          />

          <FigureTile
            label="Week average"
            icon={CalendarRange}
            value={
              <span className="pa-stat text-[1.6rem] tabular-nums">
                {week.average.toLocaleString()}
              </span>
            }
            suffix="kcal"
            /* Says its own divisor. An average over "the week" that quietly
               divides by seven reports a 2,000-a-day Tuesday as 570. */
            hint={
              week.loggedDays === 0
                ? 'No days logged this week'
                : `Across ${week.loggedDays} logged ${plural(week.loggedDays, 'day', 'days')}`
            }
          />
        </div>

        <Meter value={stats.ratio} complete={stats.over ? false : undefined} className="mt-4" />

        {/* The macros the day can actually account for. Absent — not zeroed —
            on a day where nothing was weighed, because three noughts under the
            meter reads as a diet with no protein in it rather than as a day
            logged in whole meals. */}
        {macros ? <MacroStrip totals={macros} className="mt-4" /> : null}

        {/* ---- the week, and the day switcher, as one control ---- */}
        <div className="-mx-1.5 mt-4 flex items-stretch gap-0.5 sm:mx-0 sm:gap-1" role="group" aria-label="Days this week">
          {week.days.map((entry) => {
            const selected = entry.day === day;
            const height = barHeight(entry.total, stats.target);
            const over = stats.target > 0 && entry.total > stats.target;
            return (
              <button
                key={entry.day}
                type="button"
                onClick={() => setDay(entry.day)}
                className="pa-daybtn pa-focus"
                data-selected={selected ? 'true' : 'false'}
                data-today={isToday(entry.day, today) ? 'true' : 'false'}
                /* Dimmed only when a future day is EMPTY. A day you have
                   already planned is not "not yet" — it is the prep list, and
                   fading it hides the one thing planning ahead is for. */
                data-future={
                  isFutureDay(entry.day, today) && entry.entries === 0 ? 'true' : 'false'
                }
                aria-pressed={selected}
                aria-label={`${formatKey(entry.day, 'EEEE d MMMM')} — ${entry.total.toLocaleString()} kcal`}
                data-tip={`${relativeDayLabel(entry.day, today)} · ${entry.total.toLocaleString()} kcal`}
              >
                <span className="text-[9.5px] uppercase leading-none tracking-[0.12em] text-[color:var(--pa-faint)]">
                  {weekdayShort(entry.day)}
                </span>
                <span className="pa-daybar" aria-hidden>
                  <span
                    className="pa-daybar-fill"
                    data-over={over ? 'true' : 'false'}
                    style={{ height: `${height * 100}%` }}
                  />
                </span>
                <span
                  className={clsx(
                    'text-[11px] tabular-nums leading-none',
                    selected ? 'text-[color:var(--pa-navy)]' : 'text-[color:var(--pa-faint)]',
                  )}
                >
                  {entry.entries === 0 ? dayNumber(entry.day) : entry.total.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </motion.section>

      {/* ================= 2. the day's list ================= */}
      <motion.section
        {...rise(1)}
        aria-label={`What you ate on ${formatKey(day, 'EEEE d MMMM')}`}
        className="pa-panel p-5 sm:p-6"
      >
        <SectionHeader
          eyebrow={relativeDayLabel(day, today)}
          title="What you ate"
          icon={UtensilsCrossed}
          action={
            entries.length > 0 ? (
              <span className="pa-badge tabular-nums">
                {stats.eaten.toLocaleString()} kcal
              </span>
            ) : null
          }
        />

        {entries.length > 0 ? (
          <ul className="mt-5 space-y-1.5">
            <AnimatePresence initial={false}>
              {entries.map((entry) => (
                <motion.li
                  key={entry.id}
                  layout={false}
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.16 } }}
                  transition={{ duration: 0.28, ease: HOUSE_EASE }}
                  className="pa-row pa-row-hover group px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <InlineText
                      value={entry.name}
                      onCommit={(name) => actions.updateFood(entry.id, { name })}
                      label="What you ate"
                      className="min-w-0 flex-1 text-[13.5px] leading-snug"
                    />

                    {/* `pa-ghost-slot` gives the figure a resting box and a
                        floor on its width — see the note in assistant.css. It
                        is the field on this row you reach for most, and sized
                        to its own three digits it was the smallest thing here. */}
                    <InlineNumber
                      value={entry.calories}
                      onCommit={(calories) => actions.updateFood(entry.id, { calories })}
                      max={100_000}
                      suffix="kcal"
                      label={`Calories in ${entry.name}`}
                      className="pa-ghost-slot shrink-0 text-[14.5px] font-medium tabular-nums text-[color:var(--pa-navy)]"
                    />

                    {/* Only for a line that is NOT already in the library —
                        offering to save what you saved is just noise. */}
                    {entry.mealId === null ? (
                      <button
                        type="button"
                        onClick={() => saveAsMeal(entry.id, entry.name)}
                        aria-label={`Save "${entry.name}" as a meal`}
                        data-tip="Save as a meal"
                        className="pa-icon-btn pa-focus size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
                      >
                        <BookmarkPlus className="size-3.5" strokeWidth={1.9} aria-hidden />
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => actions.deleteFood(entry.id)}
                      data-danger="true"
                      aria-label={`Delete "${entry.name}"`}
                      data-tip="Delete"
                      className="pa-icon-btn pa-focus size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
                    </button>
                  </div>

                  {/* What is in it, when it came from a meal. Read-only: this
                      is a record of what that day was, and the library is
                      where the recipe is edited. Retyping the total detaches
                      it rather than leaving a list that no longer adds up. */}
                  {entry.items.length > 0 ? (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pr-1 text-[11.5px] leading-none text-[color:var(--pa-faint)]">
                      {entry.items.map((item, index) => (
                        <span key={item.id} className="inline-flex items-center gap-1.5">
                          {index > 0 ? <span aria-hidden>·</span> : null}
                          <span>{item.name}</span>
                          {/* The weight, when there is one, sits between the
                              name and the figure — it is the reason the figure
                              is what it is. */}
                          {item.grams !== undefined ? (
                            <span className="tabular-nums opacity-70">
                              {gramsLabel(item.grams)} g
                            </span>
                          ) : null}
                          <span className="tabular-nums opacity-70">{item.calories}</span>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="mt-5 text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
            Nothing logged for {relativeDayLabel(day, today).toLowerCase()} yet. A whole day can be
            one line if you want it to be.
          </p>
        )}

        {/* ---- one line to add another ---- */}
        <form onSubmit={submit} className="pa-capture mt-4 flex items-center gap-2 p-2">
          <input
            ref={nameRef}
            value={nameDraft}
            onChange={(event) => setNameDraft(capitaliseOnType(event))}
            placeholder="What did you eat?"
            aria-label="What did you eat"
            className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[13.5px] leading-snug tracking-tight text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
          />

          {/* Named on the input itself rather than by a wrapping label with an
              sr-only span: the visible "kcal" beside it is a unit, not a name,
              and it is the only text a label could have borrowed. */}
          <span className="pa-capture-slot shrink-0">
            <input
              value={kcalDraft}
              onChange={(event) => setKcalDraft(event.target.value)}
              inputMode="numeric"
              placeholder="—"
              aria-label="Calories"
              className="w-[6ch] border-0 bg-transparent text-right text-[13.5px] font-medium tabular-nums text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
            />
            <span className="text-[11px] text-[color:var(--pa-faint)]" aria-hidden>
              kcal
            </span>
          </span>

          <button
            type="submit"
            disabled={nameDraft.trim().length === 0}
            aria-label="Add this to the day"
            className={clsx(
              'pa-cta pa-focus h-9 shrink-0 px-3.5 text-[13px]',
              nameDraft.trim().length === 0 && 'cursor-not-allowed opacity-40',
            )}
          >
            Add
          </button>
        </form>
      </motion.section>

      {/* ================= 3. the shelf ================= */}
      <MealLibrary day={day} today={today} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One figure.
 *
 * A cousin of StatTile rather than StatTile itself: the target's numeral is an
 * <input>, and StatTile's contract is `value: number | string`. Widening it to
 * take a node would push the editing concern into every tile in the portal for
 * the sake of one of them, so this stays local to the view that needs it.
 * ---------------------------------------------------------------------- */

interface FigureTileProps {
  label: string;
  value: ReactNode;
  suffix?: string;
  hint?: string;
  icon: LucideIcon;
  tone?: 'default' | 'green' | 'amber';
  /** Draws the field affordance around the numeral. */
  editable?: boolean;
}

const TONE_CHIP: Record<'green' | 'amber', CSSProperties> = {
  green: {
    background: 'var(--pa-green-bg)',
    color: 'var(--pa-green)',
    boxShadow:
      'inset 0 0 0 1px color-mix(in srgb, var(--pa-green) 26%, transparent), var(--pa-highlight)',
  },
  amber: {
    background: 'var(--pa-amber-bg)',
    color: 'var(--pa-amber)',
    boxShadow:
      'inset 0 0 0 1px color-mix(in srgb, var(--pa-amber) 26%, transparent), var(--pa-highlight)',
  },
};

function FigureTile({
  label,
  value,
  suffix,
  hint,
  icon: Icon,
  tone = 'default',
  editable = false,
}: FigureTileProps): JSX.Element {
  return (
    <div className="pa-tile relative overflow-hidden p-4">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-7 -top-9 size-24 rounded-full"
        style={{
          background:
            tone === 'default'
              ? 'radial-gradient(closest-side, var(--pa-accent-glow), transparent 78%)'
              : `radial-gradient(closest-side, var(--pa-${tone}-bg), transparent 78%)`,
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] font-medium uppercase leading-[1.35] tracking-[0.11em] text-[color:var(--pa-muted)]">
          {label}
        </p>
        <span
          className="pa-chip size-8 shrink-0 rounded-[0.7rem]"
          style={tone === 'default' ? undefined : TONE_CHIP[tone]}
          aria-hidden="true"
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      </div>

      <p className="relative mt-3 flex items-baseline gap-1.5">
        {value}
        {suffix ? (
          <span className="text-[13px] font-medium leading-none text-[color:var(--pa-muted)]">
            {suffix}
          </span>
        ) : null}
      </p>

      {hint ? (
        <p
          className={clsx(
            'relative mt-1.5 text-[11.5px] leading-snug',
            editable ? 'text-[color:var(--pa-ink-accent)]' : 'text-[color:var(--pa-faint)]',
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
