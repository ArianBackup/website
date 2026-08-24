/* ---------------------------------------------------------------------------
 * repo.ts — persistence.
 *
 * The whole system is one JSON document in one localStorage key, so saving,
 * exporting, importing and migrating are all atomic. Everything that touches
 * `window` is guarded: on the server, in a locked-down browser, or with a
 * corrupted payload, `load()` hands back a fresh empty document rather than
 * throwing into a render.
 * ------------------------------------------------------------------------- */

import { z } from 'zod';
import { caloriesFrom } from './derive';
import {
  DATA_VERSION,
  DEFAULT_CALORIE_TARGET,
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
  type HabitLog,
  type InboxItem,
  type LifeArea,
  type LoadUnit,
  type Meal,
  type Milestone,
  type Per100,
  type PlanExercise,
  type ReviewEntry,
  type ReviewReflections,
  type ReviewType,
  type Task,
  type Timestamp,
  type WeekPlan,
  type WorkoutDay,
  type WorkoutPlan,
} from './types';

/** The one key. Bumping the suffix is a hard reset — prefer `migrate()`. */
const STORAGE_KEY = 'assistant.data.v1';

/** Same-tab change signal. Cross-tab arrives as a native `storage` event. */
const CHANGE_EVENT = 'assistant:data-changed';

/**
 * Identifies writes made from THIS JavaScript context. `subscribe()` ignores
 * them, so the store never re-hydrates from an echo of its own save.
 */
const SOURCE_ID = `pa-${Math.random().toString(36).slice(2)}`;

export interface AssistantRepo {
  load(): AssistantData;
  save(data: AssistantData): void;
  subscribe(cb: () => void): () => void;
  exportJson(): string;
  importJson(raw: string): AssistantData;
  clear(): void;
}

/* -------------------------------------------------------------------------
 * Coercion — every field is treated as hostile input
 * ---------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function timestamp(value: unknown, fallback: Timestamp): Timestamp {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function coerceRank(value: unknown): 1 | 2 | 3 | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function coerceHorizon(value: unknown): GoalHorizon {
  return value === 'vision' || value === 'year' || value === 'quarter' ? value : 'quarter';
}

function coerceStatus(value: unknown): GoalStatus {
  return value === 'active' || value === 'achieved' || value === 'paused' || value === 'archived'
    ? value
    : 'active';
}

function coerceCadence(value: unknown): HabitCadence {
  if (isRecord(value)) {
    if (value.type === 'weekdays') {
      const days = Array.isArray(value.days)
        ? value.days
            .map((d) => num(d, 0))
            .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
        : [];
      return { type: 'weekdays', days: days.length > 0 ? days : [1, 2, 3, 4, 5] };
    }
    if (value.type === 'timesPerWeek') {
      const target = Math.min(7, Math.max(1, Math.trunc(num(value.target, 3))));
      return { type: 'timesPerWeek', target };
    }
  }
  return { type: 'daily' };
}

function coerceReflections(value: unknown): ReviewReflections {
  if (!isRecord(value)) return {};
  const out: ReviewReflections = {};
  if (typeof value.wins === 'string') out.wins = value.wins;
  if (typeof value.challenges === 'string') out.challenges = value.challenges;
  if (typeof value.lessons === 'string') out.lessons = value.lessons;
  if (typeof value.gratitude === 'string') out.gratitude = value.gratitude;
  return out;
}

/** Maps + filters an unknown array, dropping anything that can't be salvaged. */
function coerceList<T>(value: unknown, map: (row: Record<string, unknown>, index: number) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  value.forEach((row, index) => {
    if (!isRecord(row)) return;
    const mapped = map(row, index);
    if (mapped !== null) out.push(mapped);
  });
  return out;
}

function coerceAreas(value: unknown, now: Timestamp): LifeArea[] {
  return coerceList<LifeArea>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;
    return {
      id,
      name: str(row.name, 'Untitled area'),
      icon: str(row.icon, 'Circle'),
      color: str(row.color, '#0099ff'),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

function coerceGoals(value: unknown, now: Timestamp): Goal[] {
  return coerceList<Goal>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;
    return {
      id,
      areaId: optionalStr(row.areaId),
      title: str(row.title, 'Untitled goal'),
      why: str(row.why),
      horizon: coerceHorizon(row.horizon),
      parentGoalId: optionalStr(row.parentGoalId),
      targetDate: optionalStr(row.targetDate),
      status: coerceStatus(row.status),
      achievedAt: optionalStr(row.achievedAt),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

function coerceMilestones(value: unknown, now: Timestamp): Milestone[] {
  return coerceList<Milestone>(value, (row, index) => {
    const id = str(row.id);
    const goalId = str(row.goalId);
    if (!id || !goalId) return null;
    return {
      id,
      goalId,
      title: str(row.title, 'Untitled milestone'),
      targetDate: optionalStr(row.targetDate),
      completedAt: optionalStr(row.completedAt),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

function coerceTasks(value: unknown, now: Timestamp): Task[] {
  return coerceList<Task>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;
    return {
      id,
      title: str(row.title, 'Untitled task'),
      notes: str(row.notes),
      goalId: optionalStr(row.goalId),
      milestoneId: optionalStr(row.milestoneId),
      scheduledFor: optionalStr(row.scheduledFor),
      big3Rank: coerceRank(row.big3Rank),
      completedAt: optionalStr(row.completedAt),
      carryCount: Math.max(0, Math.trunc(num(row.carryCount, 0))),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

function coerceHabits(value: unknown, now: Timestamp): Habit[] {
  return coerceList<Habit>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;
    return {
      id,
      name: str(row.name, 'Untitled habit'),
      icon: str(row.icon, 'Circle'),
      areaId: optionalStr(row.areaId),
      goalId: optionalStr(row.goalId),
      cadence: coerceCadence(row.cadence),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
      archivedAt: optionalStr(row.archivedAt),
    };
  });
}

function coerceHabitLogs(value: unknown): HabitLog[] {
  const seen = new Set<string>();
  return coerceList<HabitLog>(value, (row) => {
    const habitId = str(row.habitId);
    const date = str(row.date);
    if (!habitId || !date) return null;
    const key = `${habitId}|${date}`;
    if (seen.has(key)) return null; // logs are idempotent on (habit, day)
    seen.add(key);
    return { habitId, date };
  });
}

function coerceReviews(value: unknown, now: Timestamp): ReviewEntry[] {
  return coerceList<ReviewEntry>(value, (row) => {
    const id = str(row.id);
    const date = str(row.date);
    if (!id || !date) return null;
    const type: ReviewType = row.type === 'weekly' ? 'weekly' : 'daily';
    const rating = typeof row.rating === 'number' && Number.isFinite(row.rating)
      ? Math.min(5, Math.max(1, Math.round(row.rating)))
      : null;
    const entry: ReviewEntry = {
      id,
      type,
      date,
      rating,
      reflections: coerceReflections(row.reflections),
      createdAt: timestamp(row.createdAt, now),
    };
    if (Array.isArray(row.tomorrowBig3)) {
      entry.tomorrowBig3 = row.tomorrowBig3.filter((t): t is string => typeof t === 'string');
    }
    if (typeof row.nextWeekFocus === 'string') entry.nextWeekFocus = row.nextWeekFocus;
    return entry;
  });
}

/** Clamps to a sane, finite, non-negative number and rounds to `dp` places. */
function measure(value: unknown, fallback: number, max: number, dp = 0): number {
  const raw = num(value, fallback);
  const clamped = Math.min(max, Math.max(0, raw));
  const factor = 10 ** dp;
  return Math.round(clamped * factor) / factor;
}

function coerceExercises(value: unknown, now: Timestamp): Exercise[] {
  return coerceList<Exercise>(value, (row, index) => {
    const id = str(row.id);
    const date = str(row.date);
    // Without a day there is nowhere to draw it — a session IS its date.
    if (!id || !date) return null;
    return {
      id,
      date,
      name: str(row.name, 'Untitled exercise'),
      // 0.5 of a unit is the smallest plate anyone stacks; 1000 is past any
      // human lift in either unit, so a corrupted value lands at the ceiling
      // rather than blowing the volume figures to infinity.
      load: measure(row.load, 0, 1000, 1),
      sets: Math.max(0, Math.trunc(measure(row.sets, 3, 99))),
      reps: Math.max(0, Math.trunc(measure(row.reps, 8, 999))),
      completedAt: optionalStr(row.completedAt),
      planId: optionalStr(row.planId),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

/** The exercises inside a plan. Same bounds as a logged one, minus the day. */
function coercePlanExercises(value: unknown): PlanExercise[] {
  return coerceList<PlanExercise>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;
    return {
      id,
      name: str(row.name, 'Untitled exercise'),
      load: measure(row.load, 0, 1000, 1),
      sets: Math.max(0, Math.trunc(measure(row.sets, 3, 99))),
      reps: Math.max(0, Math.trunc(measure(row.reps, 8, 999))),
      order: num(row.order, index),
    };
  });
}

function coerceWorkoutPlans(value: unknown, now: Timestamp): WorkoutPlan[] {
  return coerceList<WorkoutPlan>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;
    return {
      id,
      name: str(row.name, 'Untitled day'),
      items: coercePlanExercises(row.items),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

/**
 * The packet facts, or nothing at all.
 *
 * Returns `undefined` rather than a zeroed object when the key is missing, so
 * an ingredient that was never weighed stays an ingredient that was never
 * weighed. A default of `{kcal: 0, protein: 0, fat: 0, carbs: 0}` would read
 * downstream as "measured, and it is worth nothing" — and, worse, would then be
 * multiplied by any grams present and wipe the calories that were there.
 */
function coercePer100(value: unknown): Per100 | undefined {
  if (!isRecord(value)) return undefined;
  return {
    // 900 is past pure fat (884) and so past anything edible; the macros are
    // grams per 100 g and cannot exceed the 100 they are measured out of.
    kcal: measure(value.kcal, 0, 900, 1),
    protein: measure(value.protein, 0, 100, 1),
    fat: measure(value.fat, 0, 100, 1),
    carbs: measure(value.carbs, 0, 100, 1),
  };
}

/** Ingredients, for either a meal or a logged entry. */
function coerceItems(value: unknown): FoodItem[] {
  return coerceList<FoodItem>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;

    const item: FoodItem = {
      id,
      name: str(row.name, 'Untitled'),
      calories: Math.trunc(measure(row.calories, 0, 100_000)),
      order: num(row.order, index),
    };

    /* Both keys are OMITTED when absent, never written as zero. `typeof` and
       not `measure`'s fallback: a garbled `grams: "lots"` has to disappear, and
       `measure` would turn it into 0 g — an ingredient that weighs nothing,
       which is a claim, where absence is not. */
    if (typeof row.grams === 'number' && Number.isFinite(row.grams)) {
      item.grams = measure(row.grams, 0, 10_000, 1);
    }
    const per100 = coercePer100(row.per100);
    if (per100) item.per100 = per100;

    /* The same rule the store keeps, re-imposed on load, and the same one
       `coerceFood` applies one level up: a derived number is derived. A
       hand-edited backup claiming 150 g of a 165 kcal/100 g chicken breast came
       to 900 kcal is corrected rather than believed. Legacy items reach this
       with neither field and are left completely alone.

       The `kcal > 0` clause is `isWeighed()` in derive.ts — see types.ts, and
       `caloriesFrom` is the arithmetic itself, shared with the store and the
       seed so all three land on the same integer. */
    if (item.grams !== undefined && item.per100 !== undefined && item.per100.kcal > 0) {
      item.calories = measure(caloriesFrom(item.grams, item.per100.kcal), 0, 100_000);
    }

    return item;
  });
}

function sumItems(items: FoodItem[]): number {
  return items.reduce((total, item) => total + item.calories, 0);
}

function coerceMeals(value: unknown, now: Timestamp): Meal[] {
  return coerceList<Meal>(value, (row, index) => {
    const id = str(row.id);
    if (!id) return null;
    return {
      id,
      name: str(row.name, 'Untitled meal'),
      items: coerceItems(row.items),
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

function coerceFood(value: unknown, now: Timestamp): FoodEntry[] {
  return coerceList<FoodEntry>(value, (row, index) => {
    const id = str(row.id);
    const date = str(row.date);
    if (!id || !date) return null;
    const items = coerceItems(row.items);
    return {
      id,
      date,
      name: str(row.name, 'Untitled'),
      /* The invariant the store maintains, re-imposed on load: with a
         breakdown, the total IS the breakdown. A hand-edited backup that
         disagrees is corrected rather than believed, so the day's figures and
         the rows under them can never tell two different stories. */
      calories: items.length > 0 ? sumItems(items) : Math.trunc(measure(row.calories, 0, 100_000)),
      mealId: optionalStr(row.mealId),
      items,
      order: num(row.order, index),
      createdAt: timestamp(row.createdAt, now),
    };
  });
}

function coerceInbox(value: unknown, now: Timestamp): InboxItem[] {
  return coerceList<InboxItem>(value, (row) => {
    const id = str(row.id);
    if (!id) return null;
    return { id, text: str(row.text), createdAt: timestamp(row.createdAt, now) };
  });
}

function coerceWeeks(value: unknown): Record<DayKey, WeekPlan> {
  if (!isRecord(value)) return {};
  const out: Record<DayKey, WeekPlan> = {};
  for (const [key, plan] of Object.entries(value)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    if (isRecord(plan)) out[key] = { focus: str(plan.focus) };
    else if (typeof plan === 'string') out[key] = { focus: plan };
  }
  return out;
}

/** Same shape as `weeks`. A row with neither a name nor a plan is dropped. */
function coerceWorkoutDays(value: unknown): Record<DayKey, WorkoutDay> {
  if (!isRecord(value)) return {};
  const out: Record<DayKey, WorkoutDay> = {};
  for (const [key, day] of Object.entries(value)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    const name = isRecord(day) ? str(day.name) : typeof day === 'string' ? day : '';
    const planId = isRecord(day) ? optionalStr(day.planId) : null;
    if (name.trim().length > 0 || planId !== null) out[key] = { name: name.trim(), planId };
  }
  return out;
}

/**
 * Settings are rebuilt key by key from what the app understands TODAY, so keys
 * this build has retired (`confetti`, dropped with the celebration animation)
 * are simply left behind rather than carried forward — an export written by an
 * older build still opens, it just arrives without them.
 */
function coerceLoadUnit(value: unknown): LoadUnit {
  return value === 'lb' ? 'lb' : 'kg';
}

function coerceSettings(value: unknown): AssistantSettings {
  if (!isRecord(value)) return { ...EMPTY_DATA.settings };
  return {
    userName: str(value.userName),
    seededAt: optionalStr(value.seededAt),
    loadUnit: coerceLoadUnit(value.loadUnit),
    /* A target of zero would make "left" meaningless and divide the ring by
       nothing, so anything at or below zero falls back to the default rather
       than being honoured. 20,000 is well past any real intake. */
    calorieTarget: (() => {
      const raw = Math.trunc(num(value.calorieTarget, DEFAULT_CALORIE_TARGET));
      return raw > 0 ? Math.min(20_000, raw) : DEFAULT_CALORIE_TARGET;
    })(),
  };
}

/** A brand-new document. Always a fresh object — `EMPTY_DATA` is never shared. */
function emptyDocument(): AssistantData {
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
 * Turns anything at all into a valid `AssistantData`.
 *
 * Missing collections become empty arrays, wrong types are coerced or dropped,
 * and unknown extra keys are ignored — so a document written by a newer build
 * still opens (minus whatever this build doesn't understand).
 */
export function migrate(raw: unknown): AssistantData {
  if (!isRecord(raw)) return emptyDocument();

  const now = new Date().toISOString();
  const version = num(raw.version, DATA_VERSION);

  const doc: AssistantData = {
    version: DATA_VERSION,
    areas: coerceAreas(raw.areas, now),
    goals: coerceGoals(raw.goals, now),
    milestones: coerceMilestones(raw.milestones, now),
    tasks: coerceTasks(raw.tasks, now),
    habits: coerceHabits(raw.habits, now),
    habitLogs: coerceHabitLogs(raw.habitLogs),
    reviews: coerceReviews(raw.reviews, now),
    inbox: coerceInbox(raw.inbox, now),
    exercises: coerceExercises(raw.exercises, now),
    workoutDays: coerceWorkoutDays(raw.workoutDays),
    workoutPlans: coerceWorkoutPlans(raw.workoutPlans, now),
    food: coerceFood(raw.food, now),
    meals: coerceMeals(raw.meals, now),
    weeks: coerceWeeks(raw.weeks),
    settings: coerceSettings(raw.settings),
  };

  /* ---------------------------------------------------------------------
   * VERSION UPGRADES GO HERE.
   *
   * Each step moves the document forward exactly one version and falls
   * through to the next, so a very old payload is walked all the way up:
   *
   *   if (version < 2) upgradeV1toV2(doc);   // e.g. split `notes` into blocks
   *   if (version < 3) upgradeV2toV3(doc);
   *
   * `version < 1` needs nothing: pre-v1 documents predate `weeks` and
   * `settings.seededAt`, and the coercion above already supplied both.
   * ------------------------------------------------------------------- */
  void version;

  return doc;
}

/* -------------------------------------------------------------------------
 * Import validation
 * ---------------------------------------------------------------------- */

/* Deliberately permissive: this schema exists to tell an assistant export
 * apart from an arbitrary JSON file, not to re-type the model. `migrate()`
 * does the real normalising afterwards, and `looseObject` keeps unknown keys
 * from a newer build instead of erroring on them. */
const looseEntity = z.looseObject({ id: z.string().min(1) });

const dataSchema = z.looseObject({
  version: z.number().optional(),
  areas: z.array(looseEntity).optional(),
  goals: z.array(looseEntity).optional(),
  milestones: z.array(looseEntity).optional(),
  tasks: z.array(looseEntity).optional(),
  habits: z.array(looseEntity).optional(),
  habitLogs: z
    .array(z.looseObject({ habitId: z.string().min(1), date: z.string().min(1) }))
    .optional(),
  reviews: z.array(looseEntity).optional(),
  inbox: z.array(looseEntity).optional(),
  exercises: z.array(looseEntity).optional(),
  workoutDays: z
    .record(
      z.string(),
      z.looseObject({ name: z.string().optional(), planId: z.string().nullable().optional() }),
    )
    .optional(),
  workoutPlans: z.array(looseEntity).optional(),
  food: z.array(looseEntity).optional(),
  meals: z.array(looseEntity).optional(),
  weeks: z.record(z.string(), z.looseObject({ focus: z.string().optional() })).optional(),
  // `looseObject` again on purpose: a backup from an older build carries
  // settings keys this one has retired (`confetti`), and those must sail
  // through validation to be dropped by `coerceSettings`, not fail the import.
  settings: z
    .looseObject({
      userName: z.string().optional(),
      seededAt: z.string().nullable().optional(),
      loadUnit: z.string().optional(),
      calorieTarget: z.number().optional(),
    })
    .optional(),
});

const KNOWN_KEYS = [
  'version',
  'areas',
  'goals',
  'milestones',
  'tasks',
  'habits',
  'habitLogs',
  'reviews',
  'inbox',
  'exercises',
  'workoutDays',
  'workoutPlans',
  'food',
  'meals',
  'weeks',
  'settings',
];

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'the structure is not what this app expects';
  const path = issue.path.join('.');
  return path ? `${path} — ${issue.message.toLowerCase()}` : issue.message.toLowerCase();
}

function parseImport(raw: string): AssistantData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't valid JSON — it may have been truncated or edited.");
  }

  if (!isRecord(parsed)) {
    throw new Error('An assistant backup should be a single JSON object.');
  }

  if (!KNOWN_KEYS.some((key) => key in parsed)) {
    throw new Error("That file doesn't contain any assistant data — no goals, tasks or habits.");
  }

  const result = dataSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`That backup couldn't be read: ${describeIssue(result.error)}.`);
  }

  return migrate(result.data);
}

/* -------------------------------------------------------------------------
 * The repository
 * ---------------------------------------------------------------------- */

function readStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode, disabled storage, cross-origin iframe — all survivable.
    return null;
  }
}

function announce(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { source: SOURCE_ID } }));
  } catch {
    /* CustomEvent unavailable — cross-tab sync degrades, nothing breaks. */
  }
}

export const repo: AssistantRepo = {
  load(): AssistantData {
    const raw = readStorage();
    if (raw === null) return emptyDocument();
    try {
      return migrate(JSON.parse(raw));
    } catch {
      return emptyDocument();
    }
  },

  save(data: AssistantData): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Quota exceeded or storage denied: keep the session usable in memory.
      return;
    }
    announce();
  },

  subscribe(cb: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;

    // Same tab: only writes from ANOTHER context are worth reacting to.
    const onCustom = (event: Event): void => {
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      if (detail && detail.source === SOURCE_ID) return;
      cb();
    };

    // Other tabs: `storage` never fires in the tab that wrote it.
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      cb();
    };

    window.addEventListener(CHANGE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  },

  exportJson(): string {
    return JSON.stringify(repo.load(), null, 2);
  },

  /** Validates and normalises. Does NOT write — the store owns that. */
  importJson(raw: string): AssistantData {
    return parseImport(typeof raw === 'string' ? raw : '');
  },

  clear(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      return;
    }
    announce();
  },
};

export { STORAGE_KEY, CHANGE_EVENT };
