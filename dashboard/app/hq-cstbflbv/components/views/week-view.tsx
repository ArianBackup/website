'use client';

/* ---------------------------------------------------------------------------
 * week-view.tsx — the planning surface.
 *
 * Today answers "what now". This answers "what shape is the week", and it does
 * it with the hands: seven columns you can drag work between, plus a backlog
 * rail underneath holding everything that has no day yet.
 *
 *   1. the header   — which week you are looking at, and how to travel
 *   2. the focus    — the one sentence that makes the next seven days obvious
 *   3. the board    — Mon…Sun, each a droppable, sortable column
 *   4. the backlog  — a sunken rail; dropping here un-schedules a task
 *
 * Every list is derived (lib/derive.ts) and every change goes through
 * `actions` — dropping a card calls `scheduleTask` + `reorderTasks`, never a
 * direct write. Drag state lives here and nowhere else, so the store never
 * learns what a pointer is.
 *
 * The day comes from the provider's LIVE `today`, so midnight moves the board
 * on its own: the highlighted column steps across, past days fade, and a viewer
 * parked on "this week" is carried into the new one rather than left looking at
 * last week without noticing.
 * ------------------------------------------------------------------------- */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  CalendarArrowDown,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Layers,
  Plus,
  Star,
} from 'lucide-react';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

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
import { capitaliseOnType } from '../../lib/capitalise';
import { backlogTasks, goalTrace, overdueTasks, tasksForDay } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { DayKey, ID, Task } from '../../lib/types';

import { EmptyState } from '../shared/empty-state';
import { Meter } from '../shared/meter';
import { SectionHeader } from '../shared/section-header';
import { GLASS_FOCUS } from './daily-shutdown-dialog';

/* -------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------- */

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** Droppable ids. Task ids are uuids, so these prefixes can never collide. */
const DAY_PREFIX = 'pa-week-day:';
const BACKLOG_ID = 'pa-week-backlog';

/* Dot for a task filed under a goal with no life area. Every other dot on the
 * board takes its colour from the area it belongs to, so this one falls back to
 * the tertiary ink — muted navy on the light stage, muted white on the dark. */
const UNFILED_DOT = 'var(--pa-faint)';

/* The lit corner behind the header. `--pa-accent-glow` is deliberately stronger
 * in dark mode: a wash that reads as a bloom on white disappears entirely
 * against the navy-black stage. */
const HEADER_BLOOM =
  'radial-gradient(closest-side, var(--pa-accent-glow), ' +
  'color-mix(in srgb, var(--pa-accent-glow) 32%, transparent) 58%, transparent 78%)';

/** `.pa-check` fixes its own box in CSS, so a smaller one is set inline. */
const SMALL_CHECK: CSSProperties = {
  width: '1.05rem',
  height: '1.05rem',
  borderRadius: '0.45rem',
};

/* The card in flight leaves the board behind, so it drops its translucency for
 * the near-opaque surface a dialog uses — that is what makes it read as ABOVE
 * the columns rather than as one more tile, on either theme. */
const LIFTED_CARD: CSSProperties = { background: 'var(--pa-solid)' };

/* dnd-kit sizes the overlay from the node the card was lifted OFF, and a
 * backlog card is as wide as the rail — so dragging one out of the backlog put
 * a full-width bar in flight across all seven columns. This sizes it to what it
 * is about to become instead. `auto` on both axes, not just width: a narrower
 * card is a taller one, and the measured height is pinned the same way. */
const LIFTED_BOX: CSSProperties = { width: 'auto', height: 'auto', maxWidth: '15rem' };

/** Two-line clamp without depending on a plugin build flag. */
const CLAMP_2: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
};

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'To move a task, press space or enter to pick it up. Use the arrow keys to carry it to ' +
    'another day or to the backlog, then press space or enter to drop it. Press escape to cancel.',
};

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

function dayContainer(day: DayKey): string {
  return `${DAY_PREFIX}${day}`;
}

/** `null` means the backlog — the same shape `scheduleTask` expects. */
function dayOfContainer(containerId: string): DayKey | null {
  return containerId.startsWith(DAY_PREFIX) ? containerId.slice(DAY_PREFIX.length) : null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Where this week sits relative to the real one, said plainly. */
function offsetLabel(offset: number): string {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  return offset > 0 ? `${offset} weeks ahead` : `${Math.abs(offset)} weeks back`;
}

/* -------------------------------------------------------------------------
 * View models
 * ---------------------------------------------------------------------- */

/** A task plus the two things a compact card shows about its lineage. */
export interface WeekCard {
  task: Task;
  goalTitle: string | null;
  areaColor: string | null;
}

export interface DayColumnData {
  day: DayKey;
  cards: WeekCard[];
  done: number;
  total: number;
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export function WeekView(): JSX.Element {
  /* `today` is the provider's live day: it changes on its own at midnight and
   * re-renders this tree, so nothing here reads the clock directly. */
  const { data, today, actions } = useAssistant();
  const reduce = useReducedMotion();

  const thisMonday = weekStartKey(today);

  const [monday, setMonday] = useState<DayKey>(thisMonday);
  const [draggingId, setDraggingId] = useState<ID | null>(null);
  const [overContainer, setOverContainer] = useState<string | null>(null);

  /* When midnight also turns the week over, carry the viewer along — but only
   * if they were looking at the week that just ended. Someone who has paged
   * forward to plan a fortnight out stays where they put themselves. */
  const followedRef = useRef<DayKey>(thisMonday);
  useEffect(() => {
    const previous = followedRef.current;
    if (previous === thisMonday) return;
    followedRef.current = thisMonday;
    setMonday((current) => (current === previous ? thisMonday : current));
  }, [thisMonday]);

  const weekDays = useMemo(() => weekDaysFrom(monday), [monday]);

  /* ---- derived ---- */

  const decorate = useCallback(
    (task: Task): WeekCard => {
      const { goal, area } = goalTrace(data, task);
      return {
        task,
        goalTitle: goal?.title ?? null,
        areaColor: area?.color ?? (goal ? UNFILED_DOT : null),
      };
    },
    [data],
  );

  const columns = useMemo<DayColumnData[]>(
    () =>
      weekDays.map((day) => {
        const cards = tasksForDay(data, day).map(decorate);
        return {
          day,
          cards,
          done: cards.filter((card) => card.task.completedAt !== null).length,
          total: cards.length,
        };
      }),
    [data, decorate, weekDays],
  );

  const backlog = useMemo(() => backlogTasks(data).map(decorate), [data, decorate]);
  const overdue = useMemo(() => overdueTasks(data, today), [data, today]);

  const weekTotal = columns.reduce((sum, column) => sum + column.total, 0);
  const weekDone = columns.reduce((sum, column) => sum + column.done, 0);
  const weekRatio = weekTotal === 0 ? 0 : weekDone / weekTotal;

  const weekOffset = Math.round(daysBetween(thisMonday, monday) / 7);
  const isCurrentWeek = monday === thisMonday;

  const rangeLabel = useMemo(() => {
    const sunday = weekDays[6] ?? monday;
    const sameMonth = formatKey(monday, 'MMM yyyy') === formatKey(sunday, 'MMM yyyy');
    return sameMonth
      ? `${formatKey(monday, 'd')} – ${formatKey(sunday, 'd MMMM')}`
      : `${formatKey(monday, 'd MMM')} – ${formatKey(sunday, 'd MMM')}`;
  }, [monday, weekDays]);

  /* ---- the week's one sentence ---- */

  const storedFocus = data.weeks[monday]?.focus ?? '';
  const [focusDraft, setFocusDraft] = useState(storedFocus);
  const focusAbortRef = useRef(false);

  /* Follows the week you are looking at, and any focus written elsewhere
   * (the weekly review writes straight through to `data.weeks`). */
  useEffect(() => {
    setFocusDraft(storedFocus);
  }, [monday, storedFocus]);

  const commitFocus = useCallback((): void => {
    if (focusAbortRef.current) {
      focusAbortRef.current = false;
      setFocusDraft(storedFocus);
      return;
    }
    const next = focusDraft.trim();
    if (next === storedFocus.trim()) {
      setFocusDraft(storedFocus);
      return;
    }
    actions.setWeekFocus(monday, next);
    if (next.length === 0) {
      toast('Week focus cleared');
      return;
    }
    toast.success('Week focus set', { description: next });
  }, [actions, focusDraft, monday, storedFocus]);

  /* ---- mutations ---- */

  /* Ticking a card is its own feedback: the tick springs in, the row recedes,
   * and both the column meter and the week meter move. Nothing else is owed. */
  const handleToggle = useCallback(
    (task: Task): void => {
      actions.toggleTask(task.id);
    },
    [actions],
  );

  const handleAdd = useCallback(
    (day: DayKey, title: string): void => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      actions.addTask({ title: trimmed, scheduledFor: day });
    },
    [actions],
  );

  const handleCarryOver = useCallback((): void => {
    const moved = actions.carryOverTo(today);
    if (moved === 0) {
      toast('Nothing left to carry over');
      return;
    }
    const jumped = !isCurrentWeek;
    if (jumped) setMonday(thisMonday);
    toast.success(`${moved} ${plural(moved, 'task', 'tasks')} moved to today`, {
      description: jumped
        ? 'Rolled forward from earlier days — jumped you to this week.'
        : 'Rolled forward from earlier days.',
    });
  }, [actions, isCurrentWeek, thisMonday, today]);

  /* ---- drag and drop ---- */

  /* MouseSensor + TouchSensor, NOT PointerSensor.
   *
   * PointerSensor receives touch pointers too, which made this worse than
   * broken rather than merely broken: a distance-only 6px constraint means the
   * first 6px of ANY finger movement on a card starts a drag, so on a phone —
   * where the board collapses to one column and the cards are most of the
   * scrollable page — every attempt to scroll rescheduled a task and fired a
   * toast about it.
   *
   * Split in two, each with the constraint its input actually wants. A mouse
   * keeps `distance: 6` and desktop behaviour is byte-identical. Touch needs a
   * 220ms press with under 8px of travel, so a flick scrolls and a hold lifts.
   *
   * This has to ship with the `touch-manipulation` change on the card below:
   * the sensor without it cannot start a drag, and it without the sensor
   * leaves the board unscrollable. */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* Pointer first; corners only when there is no pointer.
   *
   * `closestCorners` on its own measures from the corners of the CARD IN
   * FLIGHT, not from the cursor. A card lifted out of the backlog is as wide as
   * the rail — 518px on a 1600px screen, two and a half columns — so with the
   * cursor over Friday its corners sat inside Thursday and Saturday, and the
   * nearer neighbour won. Measured before this changed: hovering Fri lit Thu,
   * hovering Sat lit Sun, and neither of those two days could be dropped on at
   * all no matter where you pointed.
   *
   * `pointerWithin` asks the question the hand is actually asking — which zone
   * is under the cursor — so the column you are pointing at is the column that
   * takes the card. It returns nothing for a KEYBOARD drag, which has no
   * pointer at all, so corners stay behind it as the fallback and arrow-key
   * dragging is unchanged.
   *
   * It also keeps reordering intact: over a column with cards the pointer is
   * inside both the card and the column, and `pointerWithin` sorts by distance
   * to each rect's centre, so the card wins and `handleDragEnd` still gets a
   * real index to splice at. Over the empty space below them only the column
   * matches, `overIndex` comes back -1, and the card lands at the end. */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const byPointer = pointerWithin(args);
    return byPointer.length > 0 ? byPointer : closestCorners(args);
  }, []);

  const cardById = useMemo(() => {
    const map = new Map<ID, WeekCard>();
    for (const column of columns) for (const card of column.cards) map.set(card.task.id, card);
    for (const card of backlog) map.set(card.task.id, card);
    return map;
  }, [backlog, columns]);

  const containerOfTask = useMemo(() => {
    const map = new Map<ID, string>();
    for (const column of columns) {
      const containerId = dayContainer(column.day);
      for (const card of column.cards) map.set(card.task.id, containerId);
    }
    for (const card of backlog) map.set(card.task.id, BACKLOG_ID);
    return map;
  }, [backlog, columns]);

  const itemsByContainer = useMemo(() => {
    const map = new Map<string, ID[]>();
    for (const column of columns) {
      map.set(
        dayContainer(column.day),
        column.cards.map((card) => card.task.id),
      );
    }
    map.set(
      BACKLOG_ID,
      backlog.map((card) => card.task.id),
    );
    return map;
  }, [backlog, columns]);

  /** A droppable id resolves to itself; a task id resolves to its column. */
  const resolveContainer = useCallback(
    (id: string): string | null => {
      if (id === BACKLOG_ID || id.startsWith(DAY_PREFIX)) return id;
      return containerOfTask.get(id) ?? null;
    },
    [containerOfTask],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const id = String(event.active.id);
      setDraggingId(id);
      setOverContainer(resolveContainer(id));
    },
    [resolveContainer],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent): void => {
      const { over } = event;
      setOverContainer(over ? resolveContainer(String(over.id)) : null);
    },
    [resolveContainer],
  );

  const handleDragCancel = useCallback((): void => {
    setDraggingId(null);
    setOverContainer(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event;
      setDraggingId(null);
      setOverContainer(null);
      if (!over) return;

      const taskId = String(active.id);
      const overId = String(over.id);
      const from = resolveContainer(taskId);
      const to = resolveContainer(overId);
      if (from === null || to === null) return;

      /* ---- reorder inside one day (or inside the backlog) ---- */
      if (from === to) {
        const items = itemsByContainer.get(from) ?? [];
        const oldIndex = items.indexOf(taskId);
        const newIndex = items.indexOf(overId);
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
        actions.reorderTasks(dayOfContainer(from), arrayMove(items, oldIndex, newIndex));
        return;
      }

      /* ---- move to another day, or out to the backlog ---- */
      const targetDay = dayOfContainer(to);
      const ordered = (itemsByContainer.get(to) ?? []).filter((id) => id !== taskId);
      const overIndex = ordered.indexOf(overId);
      ordered.splice(overIndex >= 0 ? overIndex : ordered.length, 0, taskId);

      const card = cardById.get(taskId);
      const wasRanked = card?.task.big3Rank !== null && card?.task.big3Rank !== undefined;

      // `scheduleTask` drops the task at the end of its new day; the reorder
      // that follows puts it exactly where it was let go. The store's mirror is
      // advanced synchronously, so both land in the same tick.
      actions.scheduleTask(taskId, targetDay);
      actions.reorderTasks(targetDay, ordered);

      const title = card?.task.title ?? 'Task';
      const destination =
        targetDay === null ? 'the backlog' : relativeDayLabel(targetDay, today);
      toast(`Moved to ${destination}`, {
        description: wasRanked ? `${title} — Big Three rank cleared.` : title,
      });
    },
    [actions, cardById, itemsByContainer, resolveContainer, today],
  );

  /* ---- accessibility ---- */

  const titleOf = useCallback(
    (id: UniqueIdentifier): string => cardById.get(String(id))?.task.title ?? 'Task',
    [cardById],
  );

  const zoneOf = useCallback(
    (id: UniqueIdentifier): string => {
      const containerId = resolveContainer(String(id));
      if (containerId === null) return 'nowhere';
      const day = dayOfContainer(containerId);
      return day === null ? 'the backlog' : relativeDayLabel(day, today);
    },
    [resolveContainer, today],
  );

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => `Picked up ${titleOf(active.id)} from ${zoneOf(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `${titleOf(active.id)} is over ${zoneOf(over.id)}.`
          : `${titleOf(active.id)} is not over a drop zone.`,
      onDragEnd: ({ active, over }) =>
        over
          ? `${titleOf(active.id)} was dropped on ${zoneOf(over.id)}.`
          : `${titleOf(active.id)} was returned to ${zoneOf(active.id)}.`,
      onDragCancel: ({ active }) => `Move cancelled. ${titleOf(active.id)} stayed where it was.`,
    }),
    [titleOf, zoneOf],
  );

  /* ---- backlog droppable ---- */

  const { setNodeRef: setBacklogRef } = useDroppable({ id: BACKLOG_ID });
  const backlogOver = overContainer === BACKLOG_ID;
  const backlogIds = useMemo(() => backlog.map((card) => card.task.id), [backlog]);

  const activeCard = draggingId === null ? null : cardById.get(draggingId) ?? null;
  const dragging = draggingId !== null;

  /* ---- entrance ---- */

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
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[restrictToWindowEdges]}
      /* Stacked one day per row the board is ~1100px, so Monday to Sunday is a
         held drag through more than a screenful. `x: 0` because nothing here
         scrolls sideways. */
      autoScroll={{ threshold: { x: 0, y: 0.3 }, acceleration: 15 }}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-4 sm:space-y-5">
        {/* ================= 1. header + focus ================= */}
        <motion.section
          {...rise(0)}
          aria-label={`Week of ${rangeLabel}`}
          className="pa-panel relative overflow-hidden p-5 sm:p-6"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-28 size-64 rounded-full"
            style={{ background: HEADER_BLOOM }}
          />

          <div className="relative">
            <SectionHeader
              eyebrow="Planning"
              title={`Week of ${rangeLabel}`}
              subtitle={`${offsetLabel(weekOffset)}. Drag a card onto a day to schedule it, or down into the backlog to set it aside.`}
              icon={CalendarRange}
              action={
                <div className="flex w-full max-w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                  {/* The board's one primary decision, and it only exists when
                      there is something to rescue. */}
                  {overdue.length > 0 ? (
                    <GlassButton
                      className="glass-button--haze-light shrink-0"
                      size="none"
                      type="button"
                      buttonClassName={clsx(GLASS_BOX.h9.button, GLASS_FOCUS)}
                      contentClassName={GLASS_BOX.h9.content}
                      onClick={handleCarryOver}
                    >
                      <span className="inline-flex items-center gap-2">
                        <CalendarArrowDown className="size-3.5" aria-hidden="true" />
                        Carry over {overdue.length} unfinished
                      </span>
                    </GlassButton>
                  ) : null}

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

            {/* ---- 2. the focus bar ---- */}
            <div className="pa-tile mt-5 flex flex-col gap-5 p-4 sm:mt-6 sm:flex-row sm:items-center sm:gap-7">
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <span className="pa-chip size-10 shrink-0 rounded-[0.85rem]" aria-hidden>
                  <Flag className="size-4" strokeWidth={1.75} />
                </span>

                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="pa-week-focus"
                    className="block text-[10.5px] uppercase leading-none tracking-[0.13em] text-[color:var(--pa-faint)]"
                  >
                    The one thing
                  </label>

                  <div
                    className={clsx(
                      '-mx-2 mt-2 rounded-[0.7rem] px-2 py-0.5 transition-all duration-200',
                      'focus-within:bg-[color:var(--pa-accent-bg)]',
                      'focus-within:shadow-[0_0_0_3px_var(--pa-accent-glow)]',
                    )}
                  >
                    <input
                      id="pa-week-focus"
                      value={focusDraft}
                      onChange={(event) => setFocusDraft(capitaliseOnType(event))}
                      onBlur={commitFocus}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.currentTarget.blur();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          focusAbortRef.current = true;
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder="What is the one thing that would make this week a win?"
                      className={clsx(
                        'w-full border-0 bg-transparent p-0 text-[15px] leading-snug tracking-tight outline-none',
                        'placeholder:text-[13.5px] placeholder:tracking-normal placeholder:text-[color:var(--pa-faint)]',
                        focusDraft.trim().length > 0
                          ? 'text-[color:var(--pa-navy)]'
                          : 'text-[color:var(--pa-muted)]',
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* ---- the week, in three numbers ---- */}
              <div className="flex shrink-0 items-center gap-4 sm:gap-5">
                <WeekStat label="Scheduled" value={weekTotal} />
                <span
                  aria-hidden
                  className="hidden h-8 w-px bg-[color:var(--pa-line)] sm:block"
                />
                <WeekStat label="Done" value={weekDone} />
                <div className="w-24 sm:w-32">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[9.5px] uppercase leading-none tracking-[0.13em] text-[color:var(--pa-faint)]">
                      Complete
                    </span>
                    <span className="text-[12.5px] tabular-nums leading-none text-[color:var(--pa-navy)]">
                      {Math.round(weekRatio * 100)}%
                    </span>
                  </div>
                  <Meter value={weekRatio} thin className="mt-2" />
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* ================= 3. the board ================= */}
        <div
          role="group"
          aria-label={`Day columns, ${rangeLabel}`}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
        >
          {columns.map((column, index) => (
            <DayColumn
              key={column.day}
              column={column}
              index={index + 1}
              today={today}
              isOver={overContainer === dayContainer(column.day)}
              dragging={dragging}
              onToggle={handleToggle}
              onAdd={handleAdd}
            />
          ))}
        </div>

        {/* ================= 4. the backlog rail ================= */}
        <motion.section {...rise(9)} className="pa-panel p-5 sm:p-6">
          <SectionHeader
            eyebrow="Unscheduled"
            title="Backlog"
            subtitle="Work with no day on it. Drag a card up onto a column to commit to it — or drop one back here to let the week breathe."
            icon={Layers}
            action={
              backlog.length > 0 ? (
                <span className="pa-badge" data-tone={backlogOver ? 'azure' : undefined}>
                  {backlog.length} waiting
                </span>
              ) : null
            }
          />

          <div
            ref={setBacklogRef}
            data-over={backlogOver ? 'true' : 'false'}
            className={clsx(
              'mt-5 transition-colors duration-200',
              backlogOver ? 'pa-drop' : 'pa-well',
              backlog.length > 0 ? 'p-2.5' : 'px-2.5',
            )}
          >
            {backlog.length === 0 ? (
              <EmptyState
                icon={Layers}
                title={backlogOver ? 'Drop it here' : 'Nothing waiting'}
                description={
                  backlogOver
                    ? 'This task will lose its day and sit here until you want it.'
                    : 'Every task you are carrying has a day against it. Anything you drop here loses its date and waits without nagging.'
                }
              />
            ) : (
              <SortableContext items={backlogIds} strategy={rectSortingStrategy}>
                <div className="flex flex-wrap gap-2">
                  <AnimatePresence initial={false}>
                    {backlog.map((card, index) => (
                      <WeekTaskCard
                        key={card.task.id}
                        card={card}
                        index={index}
                        onToggle={handleToggle}
                        className="min-w-0 flex-[1_1_220px]"
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </SortableContext>
            )}
          </div>
        </motion.section>
      </div>

      {/* ---- the lifted card ---- */}
      <DragOverlay style={LIFTED_BOX}>
        {activeCard ? <TaskCardShell card={activeCard} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/* -------------------------------------------------------------------------
 * Week stat — one figure in the focus bar.
 * ---------------------------------------------------------------------- */

export interface WeekStatProps {
  label: string;
  value: number;
}

function WeekStat({ label, value }: WeekStatProps): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase leading-none tracking-[0.13em] text-[color:var(--pa-faint)]">
        {label}
      </p>
      <p className="pa-display mt-2 text-[19px] tabular-nums">{value}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * A day column — droppable, sortable, and its own capture bar.
 * ---------------------------------------------------------------------- */

export interface DayColumnProps {
  column: DayColumnData;
  /** Position on the board — drives the entrance stagger only. */
  index: number;
  today: DayKey;
  /** True while a drag is hovering this column. */
  isOver: boolean;
  /** True while any card on the board is in flight. */
  dragging: boolean;
  onToggle: (task: Task) => void;
  onAdd: (day: DayKey, title: string) => void;
}

function DayColumn({
  column,
  index,
  today,
  isOver,
  dragging,
  onToggle,
  onAdd,
}: DayColumnProps): JSX.Element {
  const reduce = useReducedMotion();
  const { day, cards, done, total } = column;

  const { setNodeRef } = useDroppable({ id: dayContainer(day) });

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const ids = useMemo(() => cards.map((card) => card.task.id), [cards]);
  const longLabel = formatKey(day, 'EEEE d MMMM');
  const isTodayColumn = isToday(day, today);
  const isPast = isPastDay(day, today);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = draft.trim();
    if (value.length === 0) {
      setAdding(false);
      return;
    }
    onAdd(day, value);
    setDraft('');
    // Stay open: planning a day is usually more than one thought.
    inputRef.current?.focus();
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.035, 0.3),
      }}
      aria-label={`${longLabel}${isTodayColumn ? ' (today)' : ''} — ${total} ${plural(total, 'task', 'tasks')}, ${done} done`}
      className="pa-day-col flex min-h-[150px] flex-col p-2.5 sm:min-h-[210px]"
      data-today={isTodayColumn ? 'true' : 'false'}
      data-past={isPast ? 'true' : 'false'}
      data-over={isOver ? 'true' : 'false'}
    >
      {/* ---- column header ---- */}
      <div className="flex items-start justify-between gap-2 px-1 pt-0.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] uppercase leading-none tracking-[0.14em] text-[color:var(--pa-faint)]">
            {weekdayShort(day)}
            {isTodayColumn ? (
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-[color:var(--pa-azure)]"
                style={{ boxShadow: '0 0 0 3px var(--pa-accent-glow)' }}
              />
            ) : null}
          </p>
          <p
            className={clsx(
              'pa-display mt-1.5 text-[22px]',
              isTodayColumn ? '' : 'opacity-80',
            )}
          >
            {dayNumber(day)}
          </p>
        </div>

        {total > 0 ? (
          <span
            className="pa-badge tabular-nums"
            data-tone={done === total ? 'green' : undefined}
            data-tip={`${done} of ${total} done`}
          >
            {done}/{total}
          </span>
        ) : null}
      </div>

      <Meter value={total === 0 ? 0 : done / total} thin className="mt-2.5" />

      {/* ---- the drop zone ---- */}
      <div ref={setNodeRef} className="mt-2.5 flex flex-1 flex-col gap-1.5">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <AnimatePresence initial={false}>
            {cards.map((card, cardIndex) => (
              <WeekTaskCard
                key={card.task.id}
                card={card}
                index={cardIndex}
                onToggle={onToggle}
              />
            ))}
          </AnimatePresence>
        </SortableContext>

        {cards.length === 0 ? (
          <div
            className={clsx(
              'flex flex-1 flex-col items-center justify-center gap-1 rounded-[0.9rem] px-2 py-6 text-center transition-all duration-200',
              dragging && 'pa-drop',
            )}
            data-over={isOver ? 'true' : 'false'}
          >
            <p className="text-[11.5px] leading-snug text-[color:var(--pa-faint)]">
              {dragging ? 'Drop here' : isPast ? 'Nothing was planned' : 'Nothing planned'}
            </p>
            {!dragging && !isPast ? (
              <p className="text-[10.5px] leading-snug text-[color:var(--pa-faint)] opacity-70">
                A free day is a choice too
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---- inline capture ---- */}
      <div className="mt-1.5">
        {adding ? (
          <form onSubmit={submit}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(capitaliseOnType(event))}
              onBlur={() => {
                if (draft.trim().length === 0) setAdding(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft('');
                  setAdding(false);
                }
              }}
              placeholder="New task…"
              aria-label={`Add a task on ${longLabel}`}
              className="pa-input px-2.5 py-1.5 text-[12.5px]"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={`Add a task on ${longLabel}`}
            className={clsx(
              'pa-focus flex w-full items-center gap-1.5 rounded-[0.7rem] px-2 py-1.5 text-[11.5px]',
              'text-[color:var(--pa-faint)] transition-colors duration-200',
              'hover:bg-[color:var(--pa-hover-wash)] hover:text-[color:var(--pa-muted)]',
            )}
          >
            <Plus className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
            Add
          </button>
        )}
      </div>
    </motion.section>
  );
}

/* -------------------------------------------------------------------------
 * A draggable card.
 *
 * The entrance lives on an outer motion wrapper and the drag transform on an
 * inner node, so the two never fight over the same `transform`.
 * ---------------------------------------------------------------------- */

export interface WeekTaskCardProps {
  card: WeekCard;
  /** Position in its column — drives the entrance stagger only. */
  index: number;
  onToggle: (task: Task) => void;
  className?: string;
}

function WeekTaskCard({ card, index, onToggle, className }: WeekTaskCardProps): JSX.Element {
  const reduce = useReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.task.id,
  });

  return (
    <motion.div
      layout={false}
      initial={{ opacity: 0, y: reduce ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6, transition: { duration: 0.16 } }}
      transition={{
        duration: 0.32,
        ease: HOUSE_EASE,
        delay: reduce ? 0 : Math.min(index * 0.03, 0.24),
      }}
      className={className}
    >
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={isDragging ? 'opacity-35' : undefined}
      >
        <TaskCardShell
          card={card}
          onToggle={onToggle}
          attributes={attributes}
          listeners={listeners}
        />
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
 * The card itself — shared by the board and the drag overlay.
 * ---------------------------------------------------------------------- */

export interface TaskCardShellProps {
  card: WeekCard;
  onToggle?: (task: Task) => void;
  attributes?: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
  /** Renders the lifted state used inside `<DragOverlay>`. */
  dragging?: boolean;
}

function TaskCardShell({
  card,
  onToggle,
  attributes,
  listeners,
  dragging = false,
}: TaskCardShellProps): JSX.Element {
  const reduce = useReducedMotion();
  const { task, goalTitle, areaColor } = card;

  const done = task.completedAt !== null;
  const rank = task.big3Rank;
  const ranked = rank !== null;
  const hasMeta = ranked || goalTitle !== null;

  return (
    <div
      className={clsx(
        'pa-row group flex items-start gap-2 px-2 py-2',
        dragging ? 'pa-dragging' : 'pa-row-hover',
      )}
      data-done={done ? 'true' : 'false'}
      style={dragging ? LIFTED_CARD : undefined}
    >
      {/* ---- complete ---- */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        data-tip={done ? 'Mark as not done' : 'Complete'}
        onClick={() => onToggle?.(task)}
        tabIndex={dragging ? -1 : undefined}
        className="pa-check mt-px"
        style={SMALL_CHECK}
        data-checked={done ? 'true' : 'false'}
        data-big3={ranked ? 'true' : 'false'}
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

      {/* ---- the grab surface: a real button, so the keyboard sensor can
             pick the card up with space or enter ---- */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        tabIndex={dragging ? -1 : undefined}
        aria-label={`Move "${task.title}"`}
        data-tip="Drag to another day"
        className={clsx(
          /* `touch-manipulation`, not `touch-none`. `touch-none` handed the
             card no panning at all, so a finger that landed on one — which is
             most of the page once the board is a single column — could not
             scroll. This keeps double-tap-zoom suppressed and gives panning
             back; the TouchSensor's press delay is what distinguishes the two
             gestures now. Not `sm:touch-none`, because sensors are not
             width-scoped and the two must agree at every width. */
          'pa-focus min-w-0 flex-1 touch-manipulation rounded-[0.6rem] text-left',
          /* The card IS the target — its title, its meta and its grab handle
             are one button. At 34px tall that is a thin thing to hit with a
             thumb, and unlike an icon button it cannot take an invisible pad:
             the pad would overlap the card above it. Padding instead, which
             the card can afford because it is already the widest thing on the
             row. */
          'max-sm:py-1.5',
          dragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing',
        )}
      >
        <span
          className={clsx(
            'text-[12.5px] leading-snug',
            done ? 'pa-struck' : 'text-[color:var(--pa-navy)]',
          )}
          style={CLAMP_2}
        >
          {task.title}
        </span>

        {hasMeta ? (
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
            {ranked ? (
              <>
                <Star
                  className="size-3 shrink-0 text-[color:var(--pa-azure)]"
                  strokeWidth={1.9}
                  fill="currentColor"
                  aria-hidden
                />
                <span className="sr-only">Big Three, number {rank}.</span>
              </>
            ) : null}

            {goalTitle !== null ? (
              <>
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: areaColor ?? UNFILED_DOT }}
                />
                <span className="min-w-0 flex-1 truncate text-[10.5px] leading-none text-[color:var(--pa-faint)]">
                  {goalTitle}
                </span>
              </>
            ) : null}
          </span>
        ) : null}
      </button>
    </div>
  );
}
