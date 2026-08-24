'use client';

/* ---------------------------------------------------------------------------
 * store.tsx — the single source of truth for the assistant.
 *
 * Shape of the thing:
 *   • one `useReducer` over the whole `AssistantData` document
 *   • the reducer is PURE — no `Date.now()`, no `randomUUID()`, no storage.
 *     Ids and timestamps are minted in the action creators and passed in, so
 *     the same action always produces the same next state.
 *   • a mirror ref is advanced through the same reducer on every dispatch, so
 *     creators that must answer a question ("did that just complete?") read a
 *     state that is correct SYNCHRONOUSLY, even for two dispatches in one tick.
 *   • localStorage is touched only in effects — never during render.
 *   • the provider also owns the LIVE DAY: `today` is state, not a value read
 *     once at mount, so the whole portal rolls over at local midnight without
 *     a refresh. See `useLiveToday()`.
 * ------------------------------------------------------------------------- */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { addDaysKey, todayKey, weekStartKey } from './dates';
import { caloriesFrom } from './derive';
import { repo } from './repo';
import { buildSeedData } from './seed';
import {
  DATA_VERSION,
  EMPTY_DATA,
  type AssistantData,
  type AssistantSettings,
  type DayKey,
  type Exercise,
  type FoodEntry,
  type FoodItem,
  type Goal,
  type GoalHorizon,
  type GoalStatus,
  type Habit,
  type HabitCadence,
  type ID,
  type InboxItem,
  type LifeArea,
  type Meal,
  type Milestone,
  type Per100,
  type PlanExercise,
  type ReviewEntry,
  type ReviewReflections,
  type ReviewType,
  type Task,
  type Timestamp,
  type WorkoutPlan,
} from './types';

/* -------------------------------------------------------------------------
 * Utilities (all called from creators, never from the reducer)
 * ---------------------------------------------------------------------- */

function newId(): ID {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): Timestamp {
  return new Date().toISOString();
}

function freshDocument(): AssistantData {
  return {
    version: DATA_VERSION,
    areas: [],
    goals: [],
    milestones: [],
    tasks: [],
    habits: [],
    habitLogs: [],
    reviews: [],
    inbox: [],
    exercises: [],
    workoutDays: {},
    workoutPlans: [],
    food: [],
    meals: [],
    weeks: {},
    settings: { ...EMPTY_DATA.settings },
  };
}

/**
 * Drops keys explicitly set to `undefined` so `update(id, { targetDate: undefined })`
 * can never punch a hole in a field the type says is `DayKey | null`.
 */
function definedOnly<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

function maxOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => (item.order > max ? item.order : max), -1);
}

function nextTaskOrder(state: AssistantData, day: DayKey | null): number {
  return maxOrder(state.tasks.filter((t) => t.scheduledFor === day)) + 1;
}

function nextExerciseOrder(state: AssistantData, day: DayKey): number {
  return maxOrder(state.exercises.filter((e) => e.date === day)) + 1;
}

function nextFoodOrder(state: AssistantData, day: DayKey): number {
  return maxOrder(state.food.filter((f) => f.date === day)) + 1;
}

/**
 * Keeps a measured field inside the same bounds `repo.ts` enforces on load.
 *
 * Without this the two disagree: a stepper held down could put 4,000 kg in
 * memory, and the next page load would silently clamp it to 1,000. Same
 * ceilings, applied at both ends, so what you see is what survives a reload.
 */
function bounded(value: number, max: number, dp = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(Math.min(max, Math.max(0, value)) * factor) / factor;
}

/** The same ceilings `coercePer100` applies on load. */
function boundedPer100(facts: Per100): Per100 {
  return {
    kcal: bounded(facts.kcal, 900, 1),
    protein: bounded(facts.protein, 100, 1),
    fat: bounded(facts.fat, 100, 1),
    carbs: bounded(facts.carbs, 100, 1),
  };
}

/**
 * Settles an ingredient's calories against its weight.
 *
 * Called on the finished item after every edit, so the write-through happens in
 * exactly one place rather than at each of the three call sites that can change
 * a weight or a fact. Deriving `calories` at READ instead was the obvious
 * alternative and is worse: four separate places sum items — the meal total,
 * the entry total, the day and the week — and each would round its own way, so
 * a meal could display 620 while the day it is on counted 619.
 *
 * An ingredient that is not yet weighed — see `isWeighed` in derive.ts, whose
 * condition this is — keeps whatever number it already had. That is the whole
 * of the legacy story: nothing written before this existed has either field, so
 * nothing written before this is touched. It is also what makes the facts safe
 * to fill in one box at a time.
 */
function settleItem(item: FoodItem): FoodItem {
  if (item.grams === undefined || item.per100 === undefined || item.per100.kcal <= 0) return item;
  return { ...item, calories: bounded(caloriesFrom(item.grams, item.per100.kcal), 100_000) };
}

/** What a caller may hand in for a new ingredient. */
export interface MealItemInput {
  name: string;
  calories?: number;
  grams?: number;
  per100?: Per100;
}

/** Builds a stored ingredient, omitting the optional halves rather than zeroing them. */
function buildItem(input: MealItemInput, id: ID, order: number): FoodItem {
  const item: FoodItem = {
    id,
    name: input.name.trim() || 'Untitled',
    calories: Math.trunc(bounded(input.calories ?? 0, 100_000)),
    order,
  };
  if (input.grams !== undefined) item.grams = bounded(input.grams, 10_000, 1);
  if (input.per100 !== undefined) item.per100 = boundedPer100(input.per100);
  return settleItem(item);
}

/* -------------------------------------------------------------------------
 * The live day
 *
 * "Today" is a moving target, and an app that only reads it once at mount is
 * quietly wrong for anyone who leaves a tab open overnight — the Today view
 * keeps showing yesterday, and yesterday's tasks never age into carry-overs.
 * ---------------------------------------------------------------------- */

/**
 * Milliseconds from `from` until the next local midnight, plus half a second.
 *
 * The 500ms cushion matters: timers are allowed to fire a hair EARLY, and
 * landing at 23:59:59.997 would read the old day, set the same key and re-arm
 * for another 24 hours. Built from local Y/M/D fields rather than arithmetic on
 * the epoch, so the 23- and 25-hour days either side of a DST switch are right.
 */
function msUntilNextDay(from: Date): number {
  const next = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + 1,
    0,
    0,
    0,
    500,
  );
  // Never schedule a zero/negative delay: that would spin.
  return Math.max(250, next.getTime() - from.getTime());
}

/**
 * The current local `DayKey`, kept honest by three things at once:
 *
 *  1. a timeout aimed at the next local midnight, re-armed after every flip;
 *  2. `visibilitychange`, because a backgrounded tab's timers are throttled;
 *  3. `focus`, because a laptop asleep from 23:00 to 09:00 does not run the
 *     pending timeout on time — waking to a stale day is by far the most
 *     likely way anyone actually meets this feature.
 *
 * Every path recomputes from the system clock rather than incrementing, so a
 * late, early or duplicated wake-up all settle on the same correct answer.
 */
function useLiveToday(): DayKey {
  const [today, setToday] = useState<DayKey>(todayKey);

  useEffect(() => {
    let timer = 0;
    let stopped = false;

    const sync = (): void => {
      const key = todayKey();
      setToday((current) => (current === key ? current : key));
    };

    const arm = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (stopped) return;
        sync();
        arm();
      }, msUntilNextDay(new Date()));
    };

    // Re-arming (not just syncing) is the point: after a sleep the pending
    // timeout is hours overdue and its successor would be misaligned.
    const recheck = (): void => {
      if (stopped) return;
      sync();
      arm();
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') recheck();
    };

    // The very first sync also corrects the server-rendered day for anyone
    // whose timezone differs from the machine that rendered the HTML.
    recheck();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', recheck);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', recheck);
    };
  }, []);

  return today;
}

/* -------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------- */

type Action =
  | { type: 'hydrate'; data: AssistantData }
  | { type: 'replace'; data: AssistantData }
  | { type: 'area/add'; area: LifeArea }
  | { type: 'area/update'; id: ID; patch: Partial<LifeArea> }
  | { type: 'area/delete'; id: ID }
  | { type: 'goal/add'; goal: Goal }
  | { type: 'goal/update'; id: ID; patch: Partial<Goal> }
  | { type: 'goal/delete'; id: ID }
  | { type: 'goal/status'; id: ID; status: GoalStatus; achievedAt: Timestamp | null }
  | { type: 'milestone/add'; milestone: Milestone }
  | { type: 'milestone/update'; id: ID; patch: Partial<Milestone> }
  | { type: 'milestone/toggle'; id: ID; completedAt: Timestamp | null }
  | { type: 'milestone/delete'; id: ID }
  | { type: 'task/add'; task: Task }
  | { type: 'task/update'; id: ID; patch: Partial<Task> }
  | { type: 'task/toggle'; id: ID; completedAt: Timestamp | null }
  | { type: 'task/delete'; id: ID }
  | { type: 'task/schedule'; id: ID; day: DayKey | null; order: number }
  | { type: 'task/reorder'; day: DayKey | null; orderedIds: ID[] }
  | { type: 'task/big3'; id: ID; rank: 1 | 2 | 3 | null; demoteId: ID | null }
  | { type: 'task/carry'; day: DayKey; ids: ID[]; baseOrder: number }
  | { type: 'habit/add'; habit: Habit }
  | { type: 'habit/update'; id: ID; patch: Partial<Habit> }
  | { type: 'habit/delete'; id: ID }
  | { type: 'habit/toggle'; habitId: ID; day: DayKey; logged: boolean }
  | {
      type: 'review/save';
      entry: ReviewEntry;
      tasks: Task[];
      big3Day: DayKey | null;
      weekFocus: { key: DayKey; focus: string } | null;
    }
  | { type: 'review/delete'; id: ID }
  | { type: 'week/focus'; key: DayKey; focus: string }
  | { type: 'inbox/add'; item: InboxItem }
  | { type: 'inbox/delete'; id: ID }
  | { type: 'inbox/convert'; id: ID; task: Task }
  | { type: 'exercise/update'; id: ID; patch: Partial<Exercise> }
  | { type: 'exercise/toggle'; id: ID; completedAt: Timestamp | null }
  | { type: 'exercise/clearDay'; day: DayKey }
  | { type: 'plan/add'; plan: WorkoutPlan }
  | { type: 'plan/update'; id: ID; patch: Partial<WorkoutPlan> }
  | { type: 'plan/delete'; id: ID }
  /* Laying a plan onto a day writes the exercises AND names the day. One
     gesture, one action, one undo step. */
  | { type: 'plan/apply'; exercises: Exercise[]; day: DayKey; name: string; planId: ID }
  /* `linkEntryId` is the day-line this meal was lifted OUT of, stamped with
     its provenance in the same breath. Same reason as `plan/apply`: one
     gesture, one step to walk back. */
  | { type: 'meal/add'; meal: Meal; linkEntryId?: ID }
  | { type: 'meal/update'; id: ID; patch: Partial<Meal> }
  | { type: 'meal/delete'; id: ID }
  | { type: 'food/add'; entry: FoodEntry }
  | { type: 'food/update'; id: ID; patch: Partial<FoodEntry> }
  | { type: 'food/delete'; id: ID }
  | { type: 'settings/update'; patch: Partial<AssistantSettings> };

/* -------------------------------------------------------------------------
 * Reducer
 * ---------------------------------------------------------------------- */

function reducer(state: AssistantData, action: Action): AssistantData {
  switch (action.type) {
    case 'hydrate':
    case 'replace':
      return action.data;

    /* ---- areas ---- */

    case 'area/add':
      return { ...state, areas: [...state.areas, action.area] };

    case 'area/update':
      return {
        ...state,
        areas: state.areas.map((a) => (a.id === action.id ? { ...a, ...action.patch, id: a.id } : a)),
      };

    case 'area/delete':
      // Deleting a bucket must never delete the work inside it.
      return {
        ...state,
        areas: state.areas.filter((a) => a.id !== action.id),
        goals: state.goals.map((g) => (g.areaId === action.id ? { ...g, areaId: null } : g)),
        habits: state.habits.map((h) => (h.areaId === action.id ? { ...h, areaId: null } : h)),
      };

    /* ---- goals ---- */

    case 'goal/add':
      return { ...state, goals: [...state.goals, action.goal] };

    case 'goal/update':
      return {
        ...state,
        goals: state.goals.map((g) => (g.id === action.id ? { ...g, ...action.patch, id: g.id } : g)),
      };

    case 'goal/delete': {
      const milestoneIds = new Set(
        state.milestones.filter((m) => m.goalId === action.id).map((m) => m.id),
      );
      return {
        ...state,
        goals: state.goals
          .filter((g) => g.id !== action.id)
          .map((g) => (g.parentGoalId === action.id ? { ...g, parentGoalId: null } : g)),
        milestones: state.milestones.filter((m) => m.goalId !== action.id),
        // Tasks survive their goal — they are simply unfiled.
        tasks: state.tasks.map((t) => {
          const losesGoal = t.goalId === action.id;
          const losesMilestone = t.milestoneId !== null && milestoneIds.has(t.milestoneId);
          if (!losesGoal && !losesMilestone) return t;
          return {
            ...t,
            goalId: losesGoal ? null : t.goalId,
            milestoneId: losesMilestone ? null : t.milestoneId,
          };
        }),
        habits: state.habits.map((h) => (h.goalId === action.id ? { ...h, goalId: null } : h)),
      };
    }

    case 'goal/status':
      return {
        ...state,
        goals: state.goals.map((g) =>
          g.id === action.id ? { ...g, status: action.status, achievedAt: action.achievedAt } : g,
        ),
      };

    /* ---- milestones ---- */

    case 'milestone/add':
      return { ...state, milestones: [...state.milestones, action.milestone] };

    case 'milestone/update':
      return {
        ...state,
        milestones: state.milestones.map((m) =>
          m.id === action.id ? { ...m, ...action.patch, id: m.id, goalId: m.goalId } : m,
        ),
      };

    case 'milestone/toggle':
      return {
        ...state,
        milestones: state.milestones.map((m) =>
          m.id === action.id ? { ...m, completedAt: action.completedAt } : m,
        ),
      };

    case 'milestone/delete':
      return {
        ...state,
        milestones: state.milestones.filter((m) => m.id !== action.id),
        tasks: state.tasks.map((t) =>
          t.milestoneId === action.id ? { ...t, milestoneId: null } : t,
        ),
      };

    /* ---- tasks ---- */

    case 'task/add':
      return { ...state, tasks: [...state.tasks, action.task] };

    case 'task/update':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, ...action.patch, id: t.id } : t)),
      };

    case 'task/toggle':
      // Completing the last task of a milestone deliberately does NOT tick the
      // milestone: finishing the work and declaring it done are two decisions.
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, completedAt: action.completedAt } : t,
        ),
      };

    case 'task/delete':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };

    case 'task/schedule':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? // A Big-3 rank belongs to the day it was set on, not to the task.
              { ...t, scheduledFor: action.day, order: action.order, big3Rank: null }
            : t,
        ),
      };

    case 'task/reorder': {
      const position = new Map<ID, number>();
      action.orderedIds.forEach((id, index) => position.set(id, index));
      const tail = action.orderedIds.length;
      let spare = 0;
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.scheduledFor !== action.day) return t;
          const index = position.get(t.id);
          if (index === undefined) {
            // Anything the caller didn't mention keeps its relative place, after.
            spare += 1;
            return { ...t, order: tail + spare };
          }
          return { ...t, order: index };
        }),
      };
    }

    case 'task/big3':
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id === action.id) return { ...t, big3Rank: action.rank };
          if (action.demoteId !== null && t.id === action.demoteId) return { ...t, big3Rank: null };
          return t;
        }),
      };

    case 'task/carry': {
      const carried = new Set(action.ids);
      let offset = 0;
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (!carried.has(t.id)) return t;
          const order = action.baseOrder + offset;
          offset += 1;
          return {
            ...t,
            scheduledFor: action.day,
            carryCount: t.carryCount + 1,
            big3Rank: null,
            order,
          };
        }),
      };
    }

    /* ---- habits ---- */

    case 'habit/add':
      return { ...state, habits: [...state.habits, action.habit] };

    case 'habit/update':
      return {
        ...state,
        habits: state.habits.map((h) => (h.id === action.id ? { ...h, ...action.patch, id: h.id } : h)),
      };

    case 'habit/delete':
      return {
        ...state,
        habits: state.habits.filter((h) => h.id !== action.id),
        habitLogs: state.habitLogs.filter((l) => l.habitId !== action.id),
      };

    case 'habit/toggle': {
      const without = state.habitLogs.filter(
        (l) => !(l.habitId === action.habitId && l.date === action.day),
      );
      return {
        ...state,
        habitLogs: action.logged
          ? [...without, { habitId: action.habitId, date: action.day }]
          : without,
      };
    }

    /* ---- reviews + weeks ---- */

    case 'review/save': {
      const previous = state.reviews.find(
        (r) => r.type === action.entry.type && r.date === action.entry.date,
      );

      let tasks = state.tasks;
      if (action.big3Day !== null) {
        const day = action.big3Day;

        // Re-saving a shutdown replaces the Big Three it materialised last
        // time — matched by title, and only while they are still untouched.
        const stale = new Set(
          (previous?.tomorrowBig3 ?? [])
            .map((title) => title.trim().toLowerCase())
            .filter((title) => title.length > 0),
        );
        if (stale.size > 0) {
          tasks = tasks.filter(
            (t) =>
              !(
                t.scheduledFor === day &&
                t.completedAt === null &&
                stale.has(t.title.trim().toLowerCase())
              ),
          );
        }

        // The shutdown ritual defines that day's Big Three outright.
        tasks = tasks.map((t) =>
          t.scheduledFor === day && t.big3Rank !== null ? { ...t, big3Rank: null } : t,
        );
        tasks = [...tasks, ...action.tasks];
      }

      return {
        ...state,
        tasks,
        reviews: [
          ...state.reviews.filter(
            (r) => !(r.type === action.entry.type && r.date === action.entry.date),
          ),
          action.entry,
        ],
        weeks: action.weekFocus
          ? { ...state.weeks, [action.weekFocus.key]: { focus: action.weekFocus.focus } }
          : state.weeks,
      };
    }

    case 'review/delete':
      return { ...state, reviews: state.reviews.filter((r) => r.id !== action.id) };

    case 'week/focus':
      return { ...state, weeks: { ...state.weeks, [action.key]: { focus: action.focus } } };

    /* ---- inbox ---- */

    case 'inbox/add':
      return { ...state, inbox: [action.item, ...state.inbox] };

    case 'inbox/delete':
      return { ...state, inbox: state.inbox.filter((i) => i.id !== action.id) };

    case 'inbox/convert':
      return {
        ...state,
        inbox: state.inbox.filter((i) => i.id !== action.id),
        tasks: [...state.tasks, action.task],
      };

    /* ---- training ----
       `exercises` is a list rather than one item so that copying a whole
       session forward is a single action, and therefore a single undo step. */

    case 'exercise/update':
      return {
        ...state,
        exercises: state.exercises.map((e) =>
          e.id === action.id ? { ...e, ...action.patch, id: e.id } : e,
        ),
      };

    case 'exercise/toggle':
      return {
        ...state,
        exercises: state.exercises.map((e) =>
          e.id === action.id ? { ...e, completedAt: action.completedAt } : e,
        ),
      };

    case 'exercise/clearDay': {
      // Clearing a day un-ASSIGNS it: the exercises go and so does the row
      // naming it, or the board would show an empty "Leg day" with no way to
      // pick a different one.
      const workoutDays = { ...state.workoutDays };
      delete workoutDays[action.day];
      return {
        ...state,
        exercises: state.exercises.filter((e) => e.date !== action.day),
        workoutDays,
      };
    }

    case 'plan/add':
      return { ...state, workoutPlans: [...state.workoutPlans, action.plan] };

    case 'plan/update':
      return {
        ...state,
        workoutPlans: state.workoutPlans.map((p) =>
          p.id === action.id ? { ...p, ...action.patch, id: p.id } : p,
        ),
      };

    case 'plan/delete': {
      // Days already laid out from it keep every exercise they were given;
      // only the link goes, because the thing it pointed at is gone.
      const workoutDays: Record<DayKey, typeof state.workoutDays[string]> = {};
      for (const [key, value] of Object.entries(state.workoutDays)) {
        workoutDays[key] = value.planId === action.id ? { ...value, planId: null } : value;
      }
      return {
        ...state,
        workoutPlans: state.workoutPlans.filter((p) => p.id !== action.id),
        workoutDays,
        exercises: state.exercises.map((e) =>
          e.planId === action.id ? { ...e, planId: null } : e,
        ),
      };
    }

    case 'plan/apply':
      return {
        ...state,
        exercises: [...state.exercises, ...action.exercises],
        workoutDays: {
          ...state.workoutDays,
          [action.day]: { name: action.name, planId: action.planId },
        },
      };

    /* ---- meals ---- */

    case 'meal/add': {
      const meals = [...state.meals, action.meal];
      if (action.linkEntryId === undefined) return { ...state, meals };
      return {
        ...state,
        meals,
        food: state.food.map((f) =>
          f.id === action.linkEntryId ? { ...f, mealId: action.meal.id } : f,
        ),
      };
    }

    case 'meal/update':
      return {
        ...state,
        meals: state.meals.map((m) => (m.id === action.id ? { ...m, ...action.patch, id: m.id } : m)),
      };

    case 'meal/delete':
      // Days already logged from it keep everything they were given; only the
      // provenance link goes, because the thing it pointed at is gone.
      return {
        ...state,
        meals: state.meals.filter((m) => m.id !== action.id),
        food: state.food.map((f) => (f.mealId === action.id ? { ...f, mealId: null } : f)),
      };

    /* ---- food ---- */

    case 'food/add':
      return { ...state, food: [...state.food, action.entry] };

    case 'food/update':
      return {
        ...state,
        food: state.food.map((f) => (f.id === action.id ? { ...f, ...action.patch, id: f.id } : f)),
      };

    case 'food/delete':
      return { ...state, food: state.food.filter((f) => f.id !== action.id) };

    /* ---- settings ---- */

    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------
 * The public action surface
 * ---------------------------------------------------------------------- */

export interface AssistantActions {
  addArea(input: { name: string; icon?: string; color?: string }): LifeArea;
  updateArea(id: ID, patch: Partial<Omit<LifeArea, 'id' | 'createdAt'>>): void;
  deleteArea(id: ID): void;

  addGoal(input: {
    title: string;
    why?: string;
    horizon?: GoalHorizon;
    areaId?: ID | null;
    parentGoalId?: ID | null;
    targetDate?: DayKey | null;
  }): Goal;
  updateGoal(id: ID, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>): void;
  deleteGoal(id: ID): void;
  setGoalStatus(id: ID, status: GoalStatus): void;

  addMilestone(goalId: ID, title: string, targetDate?: DayKey | null): Milestone;
  updateMilestone(id: ID, patch: Partial<Omit<Milestone, 'id' | 'goalId' | 'createdAt'>>): void;
  toggleMilestone(id: ID): boolean;
  deleteMilestone(id: ID): void;

  addTask(input: {
    title: string;
    notes?: string;
    goalId?: ID | null;
    milestoneId?: ID | null;
    scheduledFor?: DayKey | null;
    big3Rank?: 1 | 2 | 3 | null;
  }): Task;
  updateTask(id: ID, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): void;
  toggleTask(id: ID): boolean;
  deleteTask(id: ID): void;
  scheduleTask(id: ID, day: DayKey | null): void;
  reorderTasks(day: DayKey | null, orderedIds: ID[]): void;
  cycleBig3(id: ID): void;
  carryOverTo(day: DayKey): number;

  addHabit(input: {
    name: string;
    icon?: string;
    cadence?: HabitCadence;
    areaId?: ID | null;
    goalId?: ID | null;
  }): Habit;
  updateHabit(id: ID, patch: Partial<Omit<Habit, 'id' | 'createdAt'>>): void;
  deleteHabit(id: ID): void;
  toggleHabit(habitId: ID, day: DayKey): boolean;

  saveReview(entry: {
    type: ReviewType;
    date: DayKey;
    rating: number | null;
    reflections: ReviewReflections;
    tomorrowBig3?: string[];
    nextWeekFocus?: string;
  }): ReviewEntry;
  deleteReview(id: ID): void;
  setWeekFocus(mondayKey: DayKey, focus: string): void;

  addInbox(text: string): InboxItem;
  deleteInbox(id: ID): void;
  convertInboxToTask(id: ID, input?: { scheduledFor?: DayKey | null; goalId?: ID | null }): Task;

  /* A day's exercise LIST comes from the plan assigned to it — there is no
     way to type one in. What is editable on the day is what you actually did:
     the numbers, and the tick. See workouts-view.tsx. */
  updateExercise(id: ID, patch: Partial<Omit<Exercise, 'id' | 'date' | 'createdAt'>>): void;
  toggleExercise(id: ID): boolean;
  /** Un-assigns a day: its exercises and its name go, in one undo step. */
  clearWorkout(day: DayKey): number;

  /* ---- the workout plan ---- */
  addPlan(input: { name: string }): WorkoutPlan;
  renamePlan(id: ID, name: string): void;
  deletePlan(id: ID): void;
  addPlanExercise(planId: ID, input: { name: string; sets?: number; reps?: number; load?: number }): void;
  updatePlanExercise(
    planId: ID,
    itemId: ID,
    patch: { name?: string; sets?: number; reps?: number; load?: number },
  ): void;
  deletePlanExercise(planId: ID, itemId: ID): void;
  /**
   * Lays a plan onto a day: its exercises appear there and the day takes its
   * name. Returns how many landed, or 0 if the plan is empty or gone.
   */
  applyPlan(planId: ID, day: DayKey): number;

  addFood(input: { date: DayKey; name: string; calories?: number }): FoodEntry;
  updateFood(id: ID, patch: Partial<Omit<FoodEntry, 'id' | 'date' | 'createdAt'>>): void;
  deleteFood(id: ID): void;
  /** The one number the whole food view is measured against. */
  setCalorieTarget(target: number): void;

  /* ---- the meal library ---- */
  addMeal(input: { name: string; items?: MealItemInput[] }): Meal;
  renameMeal(id: ID, name: string): void;
  deleteMeal(id: ID): void;
  addMealItem(mealId: ID, input: MealItemInput): void;
  /**
   * `per100: null` clears the packet facts and lets the ingredient go back to
   * being a plain number; `grams: null` does the same for the weight. Either
   * one leaves `calories` at whatever it last worked out to, because that is
   * still the best account anyone has of what went in.
   */
  updateMealItem(
    mealId: ID,
    itemId: ID,
    patch: {
      name?: string;
      calories?: number;
      grams?: number | null;
      per100?: Per100 | null;
    },
  ): void;
  deleteMealItem(mealId: ID, itemId: ID): void;
  /** Puts a copy of the meal on a day. Returns null if the meal is gone. */
  logMeal(mealId: ID, date: DayKey): FoodEntry | null;
  /** Turns a day's line into a reusable meal. Returns null if it has no name. */
  saveEntryAsMeal(entryId: ID): Meal | null;

  updateSettings(patch: Partial<AssistantSettings>): void;
  loadSeed(): void;
  resetAll(): void;
  exportJson(): string;
  importJson(raw: string): void;
  /** Steps the whole document back one change. False when there is nothing left. */
  undo(): boolean;
  /** Steps forward again through what undo walked back. False at the front. */
  redo(): boolean;
}

export interface AssistantContextValue {
  data: AssistantData;
  hydrated: boolean;
  /** True when there is at least one step to walk back. */
  canUndo: boolean;
  /** True when undo has walked back at least one step that is still ahead. */
  canRedo: boolean;
  /**
   * The current local day, live: it changes on its own at midnight and the
   * provider re-renders, so consumers stay on the right day without a refresh.
   * Prefer this over calling `todayKey()` inline (though that keeps working
   * too, since the re-render re-runs it).
   */
  today: DayKey;
  actions: AssistantActions;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

/* -------------------------------------------------------------------------
 * Provider
 * ---------------------------------------------------------------------- */

/** How long we wait for typing to settle before writing to disk. */
const SAVE_DEBOUNCE_MS = 150;

/** How many steps back the undo stack remembers. */
const UNDO_DEPTH = 50;

export function AssistantProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, rawDispatch] = useReducer(reducer, undefined, freshDocument);
  const [hydrated, setHydrated] = useState(false);
  const today = useLiveToday();

  /* The mirror: advanced through the same pure reducer on every dispatch, so
   * creators can read a truthful "current" document without waiting for a
   * re-render — including when several actions fire in one event handler. */
  const stateRef = useRef<AssistantData>(state);

  /* Undo is a stack of whole-document snapshots taken BEFORE each change.
   * The document is small and every reducer case is pure, so a snapshot is
   * just the previous object — no diffing, and no action needs to know how to
   * invert itself. Depth lives in state as well as the ref so that the header
   * button can enable and disable itself. */
  const historyRef = useRef<AssistantData[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);

  /* And the other half of the stack: everything undo has walked back past, so
   * redo can walk forward through it again. A fresh edit discards it — the
   * future it described no longer follows from the present, which is how every
   * undo stack that is not a tree has to behave. */
  const futureRef = useRef<AssistantData[]>([]);
  const [redoDepth, setRedoDepth] = useState(0);

  const dispatch = useCallback((action: Action): void => {
    historyRef.current.push(stateRef.current);
    if (historyRef.current.length > UNDO_DEPTH) historyRef.current.shift();
    setUndoDepth(historyRef.current.length);

    if (futureRef.current.length > 0) {
      futureRef.current = [];
      setRedoDepth(0);
    }

    stateRef.current = reducer(stateRef.current, action);
    rawDispatch(action);
  }, []);

  /* Hydration and cross-tab sync are not the user's edits, so they neither
   * record a step nor survive as one — undoing back past a document that
   * arrived from another tab would silently clobber that tab's work. */
  const dispatchSilent = useCallback((action: Action): void => {
    historyRef.current = [];
    setUndoDepth(0);
    futureRef.current = [];
    setRedoDepth(0);
    stateRef.current = reducer(stateRef.current, action);
    rawDispatch(action);
  }, []);

  /** The JSON we last wrote, used to recognise (and ignore) our own echo. */
  const lastWrittenRef = useRef<string | null>(null);

  /* ---- hydrate once, on the client ---- */
  useEffect(() => {
    const loaded = repo.load();
    lastWrittenRef.current = null;
    dispatchSilent({ type: 'hydrate', data: loaded });
    setHydrated(true);
  }, [dispatchSilent]);

  /* ---- persist, debounced ---- */
  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = window.setTimeout(() => {
      lastWrittenRef.current = JSON.stringify(state);
      repo.save(state);
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, hydrated]);

  /* ---- flush on the way out (tab close, navigation, unmount) ---- */
  useEffect(() => {
    if (!hydrated) return undefined;
    const flush = (): void => {
      const snapshot = JSON.stringify(stateRef.current);
      if (snapshot === lastWrittenRef.current) return;
      lastWrittenRef.current = snapshot;
      repo.save(stateRef.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [hydrated]);

  /* ---- follow writes made in other tabs ---- */
  useEffect(() => {
    if (!hydrated) return undefined;
    return repo.subscribe(() => {
      const incoming = repo.load();
      const snapshot = JSON.stringify(incoming);
      if (snapshot === lastWrittenRef.current) return; // our own write, echoed back
      lastWrittenRef.current = snapshot;
      dispatchSilent({ type: 'replace', data: incoming });
    });
  }, [hydrated, dispatchSilent]);

  /* ---- actions: stable identity, current state via the mirror ---- */
  const actions = useMemo<AssistantActions>(() => {
    const read = (): AssistantData => stateRef.current;

    return {
      /* ---------------- areas ---------------- */
      addArea({ name, icon, color }) {
        const state0 = read();
        const area: LifeArea = {
          id: newId(),
          name: name.trim() || 'New area',
          icon: icon ?? 'Sparkles',
          color: color ?? '#0099ff',
          order: maxOrder(state0.areas) + 1,
          createdAt: now(),
        };
        dispatch({ type: 'area/add', area });
        return area;
      },
      updateArea(id, patch) {
        dispatch({ type: 'area/update', id, patch: definedOnly(patch) });
      },
      deleteArea(id) {
        dispatch({ type: 'area/delete', id });
      },

      /* ---------------- goals ---------------- */
      addGoal({ title, why, horizon, areaId, parentGoalId, targetDate }) {
        const state0 = read();
        const goal: Goal = {
          id: newId(),
          areaId: areaId ?? null,
          title: title.trim() || 'New goal',
          why: why ?? '',
          horizon: horizon ?? 'quarter',
          parentGoalId: parentGoalId ?? null,
          targetDate: targetDate ?? null,
          status: 'active',
          achievedAt: null,
          order: maxOrder(state0.goals) + 1,
          createdAt: now(),
        };
        dispatch({ type: 'goal/add', goal });
        return goal;
      },
      updateGoal(id, patch) {
        dispatch({ type: 'goal/update', id, patch: definedOnly(patch) });
      },
      deleteGoal(id) {
        dispatch({ type: 'goal/delete', id });
      },
      setGoalStatus(id, status) {
        const existing = read().goals.find((g) => g.id === id);
        const achievedAt =
          status === 'achieved' ? existing?.achievedAt ?? now() : null;
        dispatch({ type: 'goal/status', id, status, achievedAt });
      },

      /* ---------------- milestones ---------------- */
      addMilestone(goalId, title, targetDate) {
        const state0 = read();
        const siblings = state0.milestones.filter((m) => m.goalId === goalId);
        const milestone: Milestone = {
          id: newId(),
          goalId,
          title: title.trim() || 'New milestone',
          targetDate: targetDate ?? null,
          completedAt: null,
          order: maxOrder(siblings) + 1,
          createdAt: now(),
        };
        dispatch({ type: 'milestone/add', milestone });
        return milestone;
      },
      updateMilestone(id, patch) {
        dispatch({ type: 'milestone/update', id, patch: definedOnly(patch) });
      },
      toggleMilestone(id) {
        const milestone = read().milestones.find((m) => m.id === id);
        if (!milestone) return false;
        const becameComplete = milestone.completedAt === null;
        dispatch({
          type: 'milestone/toggle',
          id,
          completedAt: becameComplete ? now() : null,
        });
        return becameComplete;
      },
      deleteMilestone(id) {
        dispatch({ type: 'milestone/delete', id });
      },

      /* ---------------- tasks ---------------- */
      addTask({ title, notes, goalId, milestoneId, scheduledFor, big3Rank }) {
        const state0 = read();
        const day = scheduledFor ?? null;
        const task: Task = {
          id: newId(),
          title: title.trim() || 'New task',
          notes: notes ?? '',
          goalId: goalId ?? null,
          milestoneId: milestoneId ?? null,
          scheduledFor: day,
          big3Rank: big3Rank ?? null,
          completedAt: null,
          carryCount: 0,
          order: nextTaskOrder(state0, day),
          createdAt: now(),
        };
        dispatch({ type: 'task/add', task });
        return task;
      },
      updateTask(id, patch) {
        dispatch({ type: 'task/update', id, patch: definedOnly(patch) });
      },
      toggleTask(id) {
        const task = read().tasks.find((t) => t.id === id);
        if (!task) return false;
        const becameComplete = task.completedAt === null;
        dispatch({ type: 'task/toggle', id, completedAt: becameComplete ? now() : null });
        return becameComplete;
      },
      deleteTask(id) {
        dispatch({ type: 'task/delete', id });
      },
      scheduleTask(id, day) {
        const state0 = read();
        const task = state0.tasks.find((t) => t.id === id);
        if (!task || task.scheduledFor === day) return;
        dispatch({ type: 'task/schedule', id, day, order: nextTaskOrder(state0, day) });
      },
      reorderTasks(day, orderedIds) {
        dispatch({ type: 'task/reorder', day, orderedIds });
      },
      cycleBig3(id) {
        const state0 = read();
        const task = state0.tasks.find((t) => t.id === id);
        if (!task) return;

        // Already ranked → back to a normal task.
        if (task.big3Rank !== null) {
          dispatch({ type: 'task/big3', id, rank: null, demoteId: null });
          return;
        }

        const day = task.scheduledFor;
        const taken = new Map<number, ID>();
        for (const other of state0.tasks) {
          if (other.id === id || other.scheduledFor !== day) continue;
          if (other.big3Rank !== null) taken.set(other.big3Rank, other.id);
        }

        const free = ([1, 2, 3] as const).find((rank) => !taken.has(rank));
        if (free) {
          dispatch({ type: 'task/big3', id, rank: free, demoteId: null });
          return;
        }

        // All three claimed: the newcomer takes slot three, the old three drops out.
        dispatch({ type: 'task/big3', id, rank: 3, demoteId: taken.get(3) ?? null });
      },
      carryOverTo(day) {
        const state0 = read();
        const stragglers = state0.tasks
          .filter(
            (t) => t.scheduledFor !== null && t.scheduledFor < day && t.completedAt === null,
          )
          .sort((a, b) => {
            const sa = a.scheduledFor ?? '';
            const sb = b.scheduledFor ?? '';
            if (sa !== sb) return sa < sb ? -1 : 1;
            return a.order - b.order;
          });

        if (stragglers.length === 0) return 0;

        dispatch({
          type: 'task/carry',
          day,
          ids: stragglers.map((t) => t.id),
          baseOrder: nextTaskOrder(state0, day),
        });
        return stragglers.length;
      },

      /* ---------------- habits ---------------- */
      addHabit({ name, icon, cadence, areaId, goalId }) {
        const state0 = read();
        const habit: Habit = {
          id: newId(),
          name: name.trim() || 'New habit',
          icon: icon ?? 'Sparkles',
          areaId: areaId ?? null,
          goalId: goalId ?? null,
          cadence: cadence ?? { type: 'daily' },
          order: maxOrder(state0.habits) + 1,
          createdAt: now(),
          archivedAt: null,
        };
        dispatch({ type: 'habit/add', habit });
        return habit;
      },
      updateHabit(id, patch) {
        dispatch({ type: 'habit/update', id, patch: definedOnly(patch) });
      },
      deleteHabit(id) {
        dispatch({ type: 'habit/delete', id });
      },
      toggleHabit(habitId, day) {
        const already = read().habitLogs.some(
          (l) => l.habitId === habitId && l.date === day,
        );
        dispatch({ type: 'habit/toggle', habitId, day, logged: !already });
        return !already;
      },

      /* ---------------- reviews ---------------- */
      saveReview({ type, date, rating, reflections, tomorrowBig3, nextWeekFocus }) {
        const state0 = read();
        const createdAt = now();

        const entry: ReviewEntry = {
          id: newId(),
          type,
          date,
          rating,
          reflections: { ...reflections },
          createdAt,
        };

        const titles = (tomorrowBig3 ?? [])
          .map((title) => title.trim())
          .filter((title) => title.length > 0)
          .slice(0, 3);
        if (tomorrowBig3) entry.tomorrowBig3 = titles;
        if (typeof nextWeekFocus === 'string') entry.nextWeekFocus = nextWeekFocus;

        // A daily shutdown materialises tomorrow's Big Three as real tasks.
        let big3Day: DayKey | null = null;
        const tasks: Task[] = [];
        if (type === 'daily' && titles.length > 0) {
          big3Day = addDaysKey(date, 1);
          const baseOrder = nextTaskOrder(state0, big3Day);
          titles.forEach((title, index) => {
            tasks.push({
              id: newId(),
              title,
              notes: '',
              goalId: null,
              milestoneId: null,
              scheduledFor: big3Day,
              big3Rank: (index + 1) as 1 | 2 | 3,
              completedAt: null,
              carryCount: 0,
              order: baseOrder + index,
              createdAt,
            });
          });
        }

        // A weekly review writes its focus through to next week's plan.
        let weekFocus: { key: DayKey; focus: string } | null = null;
        if (type === 'weekly' && typeof nextWeekFocus === 'string' && nextWeekFocus.trim()) {
          weekFocus = {
            key: weekStartKey(addDaysKey(date, 7)),
            focus: nextWeekFocus.trim(),
          };
        }

        dispatch({ type: 'review/save', entry, tasks, big3Day, weekFocus });
        return entry;
      },
      deleteReview(id) {
        dispatch({ type: 'review/delete', id });
      },
      setWeekFocus(mondayKey, focus) {
        dispatch({ type: 'week/focus', key: weekStartKey(mondayKey), focus });
      },

      /* ---------------- inbox ---------------- */
      addInbox(text) {
        const item: InboxItem = { id: newId(), text: text.trim(), createdAt: now() };
        dispatch({ type: 'inbox/add', item });
        return item;
      },
      deleteInbox(id) {
        dispatch({ type: 'inbox/delete', id });
      },
      convertInboxToTask(id, input) {
        const state0 = read();
        const item = state0.inbox.find((i) => i.id === id);
        if (!item) {
          throw new Error('That inbox item no longer exists.');
        }
        const day = input?.scheduledFor ?? null;
        const task: Task = {
          id: newId(),
          title: item.text.trim() || 'Untitled',
          notes: '',
          goalId: input?.goalId ?? null,
          milestoneId: null,
          scheduledFor: day,
          big3Rank: null,
          completedAt: null,
          carryCount: 0,
          order: nextTaskOrder(state0, day),
          createdAt: now(),
        };
        dispatch({ type: 'inbox/convert', id, task });
        return task;
      },

      /* ---------------- training ---------------- */
      updateExercise(id, patch) {
        const clean = definedOnly(patch);
        // Bounded here as well as in the repo — see `bounded()`.
        if (clean.load !== undefined) clean.load = bounded(clean.load, 1000, 1);
        if (clean.sets !== undefined) clean.sets = Math.trunc(bounded(clean.sets, 99));
        if (clean.reps !== undefined) clean.reps = Math.trunc(bounded(clean.reps, 999));
        dispatch({ type: 'exercise/update', id, patch: clean });
      },
      toggleExercise(id) {
        const exercise = read().exercises.find((e) => e.id === id);
        if (!exercise) return false;
        const becameComplete = exercise.completedAt === null;
        dispatch({ type: 'exercise/toggle', id, completedAt: becameComplete ? now() : null });
        return becameComplete;
      },
      clearWorkout(day) {
        const count = read().exercises.reduce((n, e) => (e.date === day ? n + 1 : n), 0);
        if (count === 0) return 0;
        dispatch({ type: 'exercise/clearDay', day });
        return count;
      },

      /* ---------------- the workout plan ----------------
       * Exercises are edited by replacing the plan's whole `items` array, for
       * the same reason meals are: a plan is a handful of lines, and it keeps
       * the reducer at four cases instead of seven. */
      addPlan({ name }) {
        const state0 = read();
        const plan: WorkoutPlan = {
          id: newId(),
          name: name.trim() || 'New day',
          items: [],
          order: maxOrder(state0.workoutPlans) + 1,
          createdAt: now(),
        };
        dispatch({ type: 'plan/add', plan });
        return plan;
      },
      renamePlan(id, name) {
        const clean = name.trim();
        if (clean.length === 0) return;
        dispatch({ type: 'plan/update', id, patch: { name: clean } });
      },
      deletePlan(id) {
        dispatch({ type: 'plan/delete', id });
      },
      addPlanExercise(planId, { name, sets, reps, load }) {
        const plan = read().workoutPlans.find((p) => p.id === planId);
        if (!plan) return;
        const item: PlanExercise = {
          id: newId(),
          name: name.trim() || 'New exercise',
          load: bounded(load ?? 0, 1000, 1),
          sets: Math.trunc(bounded(sets ?? 3, 99)),
          reps: Math.trunc(bounded(reps ?? 8, 999)),
          order: maxOrder(plan.items) + 1,
        };
        dispatch({ type: 'plan/update', id: planId, patch: { items: [...plan.items, item] } });
      },
      updatePlanExercise(planId, itemId, patch) {
        const plan = read().workoutPlans.find((p) => p.id === planId);
        if (!plan) return;
        const items = plan.items.map((item) => {
          if (item.id !== itemId) return item;
          return {
            ...item,
            name: patch.name === undefined ? item.name : patch.name.trim() || item.name,
            load: patch.load === undefined ? item.load : bounded(patch.load, 1000, 1),
            sets: patch.sets === undefined ? item.sets : Math.trunc(bounded(patch.sets, 99)),
            reps: patch.reps === undefined ? item.reps : Math.trunc(bounded(patch.reps, 999)),
          };
        });
        dispatch({ type: 'plan/update', id: planId, patch: { items } });
      },
      deletePlanExercise(planId, itemId) {
        const plan = read().workoutPlans.find((p) => p.id === planId);
        if (!plan) return;
        dispatch({
          type: 'plan/update',
          id: planId,
          patch: { items: plan.items.filter((item) => item.id !== itemId) },
        });
      },
      applyPlan(planId, day) {
        const state0 = read();
        const plan = state0.workoutPlans.find((p) => p.id === planId);
        if (!plan || plan.items.length === 0) return 0;

        /* ---- pick up where you left off ----
         * The plan supplies the exercise LIST. The numbers come from the last
         * day you ran this same plan, matched by exercise name, because those
         * are the weights you finished on — a template frozen at whatever it
         * was written with would hand you the same load every week forever.
         * An exercise added to the plan since then has no history and falls
         * back to the plan's own figures. */
        let previous: DayKey | null = null;
        for (const [key, value] of Object.entries(state0.workoutDays)) {
          if (value.planId !== planId || key >= day) continue;
          if (previous === null || key > previous) previous = key;
        }
        const carried = new Map<string, Exercise>();
        if (previous !== null) {
          for (const exercise of state0.exercises) {
            if (exercise.date === previous) carried.set(exercise.name.toLowerCase(), exercise);
          }
        }

        const createdAt = now();
        const baseOrder = nextExerciseOrder(state0, day);
        const exercises: Exercise[] = [...plan.items]
          .sort((a, b) => a.order - b.order)
          .map((item, index) => {
            const last = carried.get(item.name.toLowerCase());
            return {
              id: newId(),
              date: day,
              name: item.name,
              load: last ? last.load : item.load,
              sets: last ? last.sets : item.sets,
              reps: last ? last.reps : item.reps,
              completedAt: null,
              planId: plan.id,
              order: baseOrder + index,
              createdAt,
            };
          });

        dispatch({ type: 'plan/apply', exercises, day, name: plan.name, planId: plan.id });
        return exercises.length;
      },

      /* ---------------- food ---------------- */
      addFood({ date, name, calories }) {
        const state0 = read();
        const entry: FoodEntry = {
          id: newId(),
          date,
          name: name.trim() || 'Untitled',
          calories: Math.trunc(bounded(calories ?? 0, 100_000)),
          mealId: null,
          items: [],
          order: nextFoodOrder(state0, date),
          createdAt: now(),
        };
        dispatch({ type: 'food/add', entry });
        return entry;
      },
      updateFood(id, patch) {
        const clean = definedOnly(patch);
        if (clean.calories !== undefined) {
          clean.calories = Math.trunc(bounded(clean.calories, 100_000));
          /* Retyping the total of a line that came from a meal detaches the
           * breakdown rather than leaving it contradicting the number above
           * it. You ate a bit less of it; the ingredient list is no longer a
           * true account of that, and a stale one is worse than none. */
          const entry = read().food.find((f) => f.id === id);
          if (entry && entry.items.length > 0 && clean.calories !== entry.calories) {
            clean.items = [];
          }
        }
        dispatch({ type: 'food/update', id, patch: clean });
      },
      deleteFood(id) {
        dispatch({ type: 'food/delete', id });
      },
      setCalorieTarget(target) {
        // A zero target divides the ring by nothing and makes "left" a lie, so
        // it is refused rather than stored — the field simply snaps back.
        const clean = Math.trunc(bounded(target, 20_000));
        if (clean <= 0) return;
        dispatch({ type: 'settings/update', patch: { calorieTarget: clean } });
      },

      /* ---------------- the meal library ----------------
       * Items are edited by replacing the meal's whole `items` array. A meal
       * is a handful of lines, the reducer stays four cases instead of seven,
       * and every edit is one undo step either way. */
      addMeal({ name, items }) {
        const state0 = read();
        const meal: Meal = {
          id: newId(),
          name: name.trim() || 'New meal',
          items: (items ?? []).map((item, index) => buildItem(item, newId(), index)),
          order: maxOrder(state0.meals) + 1,
          createdAt: now(),
        };
        dispatch({ type: 'meal/add', meal });
        return meal;
      },
      renameMeal(id, name) {
        const clean = name.trim();
        if (clean.length === 0) return;
        dispatch({ type: 'meal/update', id, patch: { name: clean } });
      },
      deleteMeal(id) {
        dispatch({ type: 'meal/delete', id });
      },
      addMealItem(mealId, input) {
        const meal = read().meals.find((m) => m.id === mealId);
        if (!meal) return;
        const item = buildItem(input, newId(), maxOrder(meal.items) + 1);
        dispatch({ type: 'meal/update', id: mealId, patch: { items: [...meal.items, item] } });
      },
      updateMealItem(mealId, itemId, patch) {
        const meal = read().meals.find((m) => m.id === mealId);
        if (!meal) return;
        const items = meal.items.map((item) => {
          if (item.id !== itemId) return item;

          const next: FoodItem = {
            ...item,
            name: patch.name === undefined ? item.name : patch.name.trim() || item.name,
            calories:
              patch.calories === undefined
                ? item.calories
                : Math.trunc(bounded(patch.calories, 100_000)),
          };

          /* `null` clears, a number sets, `undefined` leaves alone — and the
           * key is DELETED rather than set to undefined, so the item that gets
           * serialised has no `grams` at all instead of a hole where one was. */
          if (patch.grams === null) delete next.grams;
          else if (patch.grams !== undefined) next.grams = bounded(patch.grams, 10_000, 1);

          if (patch.per100 === null) delete next.per100;
          else if (patch.per100 !== undefined) next.per100 = boundedPer100(patch.per100);

          return settleItem(next);
        });
        dispatch({ type: 'meal/update', id: mealId, patch: { items } });
      },
      deleteMealItem(mealId, itemId) {
        const meal = read().meals.find((m) => m.id === mealId);
        if (!meal) return;
        dispatch({
          type: 'meal/update',
          id: mealId,
          patch: { items: meal.items.filter((item) => item.id !== itemId) },
        });
      },
      logMeal(mealId, date) {
        const state0 = read();
        const meal = state0.meals.find((m) => m.id === mealId);
        if (!meal) return null;

        // Fresh ids on the copied items: they belong to this day now, and two
        // days logged from the same meal must not share item identity.
        const items: FoodItem[] = meal.items.map((item, index) => ({
          ...item,
          id: newId(),
          order: index,
        }));
        const entry: FoodEntry = {
          id: newId(),
          date,
          name: meal.name,
          calories: items.reduce((total, item) => total + item.calories, 0),
          mealId: meal.id,
          items,
          order: nextFoodOrder(state0, date),
          createdAt: now(),
        };
        dispatch({ type: 'food/add', entry });
        return entry;
      },
      saveEntryAsMeal(entryId) {
        const state0 = read();
        const entry = state0.food.find((f) => f.id === entryId);
        if (!entry) return null;

        // A one-off with no breakdown becomes a one-ingredient meal rather
        // than an empty one, so its calories survive the trip.
        const source =
          entry.items.length > 0
            ? entry.items
            : [{ id: entry.id, name: entry.name, calories: entry.calories, order: 0 }];

        const meal: Meal = {
          id: newId(),
          name: entry.name,
          items: source.map((item, index) => ({ ...item, id: newId(), order: index })),
          order: maxOrder(state0.meals) + 1,
          createdAt: now(),
        };
        // The day it came from now points at the library, so it counts as a use.
        dispatch({ type: 'meal/add', meal, linkEntryId: entryId });
        return meal;
      },

      /* ---------------- document ---------------- */
      updateSettings(patch) {
        dispatch({ type: 'settings/update', patch: definedOnly(patch) });
      },
      loadSeed() {
        dispatch({ type: 'replace', data: buildSeedData() });
      },
      resetAll() {
        dispatch({ type: 'replace', data: freshDocument() });
      },
      exportJson() {
        return JSON.stringify(read(), null, 2);
      },
      importJson(raw) {
        // Throws an Error carrying a message that is safe to show a human.
        const next = repo.importJson(raw);
        dispatch({ type: 'replace', data: next });
      },

      undo() {
        const previous = historyRef.current.pop();
        if (previous === undefined) return false;
        setUndoDepth(historyRef.current.length);
        // The document being left behind becomes the step redo walks back to.
        futureRef.current.push(stateRef.current);
        setRedoDepth(futureRef.current.length);
        // Restoring is itself a 'replace', but it must not go through
        // `dispatch` — that would push a step of its own and clear the future,
        // and undo would toggle between two documents forever.
        stateRef.current = previous;
        rawDispatch({ type: 'replace', data: previous });
        return true;
      },

      redo() {
        const next = futureRef.current.pop();
        if (next === undefined) return false;
        setRedoDepth(futureRef.current.length);
        // Symmetric: what we are leaving goes back onto the undo stack, and
        // this restore bypasses `dispatch` for the same reason undo does.
        historyRef.current.push(stateRef.current);
        setUndoDepth(historyRef.current.length);
        stateRef.current = next;
        rawDispatch({ type: 'replace', data: next });
        return true;
      },
    };
  }, [dispatch]);

  const value = useMemo<AssistantContextValue>(
    () => ({
      data: state,
      hydrated,
      canUndo: undoDepth > 0,
      canRedo: redoDepth > 0,
      today,
      actions,
    }),
    [state, hydrated, undoDepth, redoDepth, today, actions],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error('useAssistant must be used inside <AssistantProvider>.');
  }
  return context;
}
