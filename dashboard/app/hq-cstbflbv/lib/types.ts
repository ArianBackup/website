/* ---------------------------------------------------------------------------
 * types.ts — the complete domain model for the Personal Assistant portal.
 *
 * The shape of the system is a cascade:
 *
 *   LifeArea  →  Goal (vision / year / quarter)  →  Milestone  →  Task
 *                                                        ↑
 *                              Habit ──────────────── HabitLog
 *
 * Progress only ever flows UP and is always derived, never stored: completing
 * a Task fills its Milestone, completed Milestones fill their Goal, and active
 * Goals fill their LifeArea. See lib/derive.ts.
 *
 * Everything the app owns lives in a single `AssistantData` document so that
 * persistence, export/import and migration are atomic.
 * ------------------------------------------------------------------------- */

/** A uuid, from `crypto.randomUUID()`. */
export type ID = string;

/**
 * A calendar day in LOCAL time, `'yyyy-MM-dd'`.
 * Always produced by `dates.ts` helpers — never `toISOString().slice(0, 10)`,
 * which silently shifts the day for anyone east or west of UTC.
 */
export type DayKey = string;

/** A full ISO-8601 instant, from `new Date().toISOString()`. */
export type Timestamp = string;

/* -------------------------------------------------------------------------
 * Life areas — the top-level buckets a life is organised into.
 * ---------------------------------------------------------------------- */

export interface LifeArea {
  id: ID;
  name: string;
  /** A lucide-react icon name, resolved through `lib/icons.ts`. */
  icon: string;
  /** Accent hex used for the area's chip, dot and chart series. */
  color: string;
  order: number;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------
 * Goals
 * ---------------------------------------------------------------------- */

/**
 * How far out a goal reaches.
 *  - `vision`  : the 3–10 year "who I'm becoming" statement
 *  - `year`    : a 12-month outcome
 *  - `quarter` : a 90-day outcome, the level that actually drives weeks
 */
export type GoalHorizon = 'vision' | 'year' | 'quarter';

export type GoalStatus = 'active' | 'achieved' | 'paused' | 'archived';

export interface Goal {
  id: ID;
  areaId: ID | null;
  title: string;
  /** The motivation. Surfaced on task rows so the "why" is never lost. */
  why: string;
  horizon: GoalHorizon;
  /** Optional parent goal, letting a quarter goal ladder up to a year goal. */
  parentGoalId: ID | null;
  targetDate: DayKey | null;
  status: GoalStatus;
  achievedAt: Timestamp | null;
  order: number;
  createdAt: Timestamp;
}

export interface Milestone {
  id: ID;
  goalId: ID;
  title: string;
  targetDate: DayKey | null;
  completedAt: Timestamp | null;
  order: number;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------
 * Tasks — the daily actions at the bottom of the cascade.
 * ---------------------------------------------------------------------- */

export interface Task {
  id: ID;
  title: string;
  notes: string;
  /** Links up the cascade. A task may hang off a goal directly or off one of
   *  its milestones; `milestoneId` implies `goalId`. */
  goalId: ID | null;
  milestoneId: ID | null;
  /** `null` means unscheduled — it sits in the backlog. */
  scheduledFor: DayKey | null;
  /** 1–3 marks it as one of that day's Big Three; `null` is a normal task. */
  big3Rank: 1 | 2 | 3 | null;
  completedAt: Timestamp | null;
  /** Increments each time the task is rolled forward from an unfinished day.
   *  A high count is a signal the task is too big or not really wanted. */
  carryCount: number;
  /** Sort position within its day (or within the backlog). */
  order: number;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------
 * Habits — recurring actions, tracked by streak rather than completion.
 * ---------------------------------------------------------------------- */

export type HabitCadence =
  /** Every single day. */
  | { type: 'daily' }
  /** Specific weekdays. `days` holds ISO weekday numbers, 1 = Mon … 7 = Sun. */
  | { type: 'weekdays'; days: number[] }
  /** Any `target` days within a Mon–Sun week. */
  | { type: 'timesPerWeek'; target: number };

export interface Habit {
  id: ID;
  name: string;
  icon: string;
  areaId: ID | null;
  /** Optionally ties the habit to the goal it compounds toward. */
  goalId: ID | null;
  cadence: HabitCadence;
  order: number;
  createdAt: Timestamp;
  archivedAt: Timestamp | null;
}

/** One row per completed day. Toggling is idempotent on (habitId, date). */
export interface HabitLog {
  habitId: ID;
  date: DayKey;
}

/* -------------------------------------------------------------------------
 * Reviews — the daily shutdown and the weekly retrospective.
 * ---------------------------------------------------------------------- */

export type ReviewType = 'daily' | 'weekly';

export interface ReviewReflections {
  wins?: string;
  challenges?: string;
  lessons?: string;
  gratitude?: string;
}

export interface ReviewEntry {
  id: ID;
  type: ReviewType;
  /** For `daily`, the day reviewed. For `weekly`, that week's Monday. */
  date: DayKey;
  /** Self-rating, 1–5. */
  rating: number | null;
  reflections: ReviewReflections;
  /** Daily shutdown only — materialised into real tasks on save. */
  tomorrowBig3?: string[];
  /** Weekly review only — written through to `AssistantData.weeks`. */
  nextWeekFocus?: string;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------
 * Training — what you lifted, on which day.
 *
 * Deliberately flat and day-keyed, exactly like `Task`: there is no "workout"
 * or "session" entity above these. A session IS the exercises that share a
 * date, which means creating one costs nothing (type a name into a day) and
 * deleting the last exercise leaves no empty husk behind to tidy up.
 * ---------------------------------------------------------------------- */

export interface Exercise {
  id: ID;
  /** The day this belongs to. There is no unscheduled state — see above. */
  date: DayKey;
  name: string;
  /** Working weight, in `settings.loadUnit`. Bodyweight work is simply 0. */
  load: number;
  sets: number;
  reps: number;
  /** Ticked off during the session. */
  completedAt: Timestamp | null;
  /** The plan this was laid out from, if any. Provenance only — see below. */
  planId: ID | null;
  /** Sort position within its day. */
  order: number;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------
 * The workout plan — the muscle-group days you keep.
 *
 * Exactly the shape the meal library has, for the same reason: you write down
 * what a leg day IS once, then a day on the board becomes one by picking it.
 * Applying a plan COPIES its exercises onto the day; editing the plan later
 * changes what next Monday looks like and nothing about last Monday.
 *
 * A plan carries loads too, but only as a starting point. What actually lands
 * on the day is what you lifted the LAST time you ran that plan — see
 * `applyPlan` in store.tsx. A template frozen at its original numbers would
 * hand you the same weight forever, which is the opposite of training.
 * ---------------------------------------------------------------------- */

export interface PlanExercise {
  id: ID;
  name: string;
  load: number;
  sets: number;
  reps: number;
  order: number;
}

export interface WorkoutPlan {
  id: ID;
  /** "Leg day", "Push", "Pull" — what the day is called when you pick it. */
  name: string;
  items: PlanExercise[];
  order: number;
  createdAt: Timestamp;
}

/** What a weight can be counted in. */
export type LoadUnit = 'kg' | 'lb';

/** What a day of training is called, keyed by its `DayKey`. Same shape as
 *  `WeekPlan`: a name is not worth an entity, and a day with neither a name
 *  nor a plan behind it has no row at all. */
export interface WorkoutDay {
  name: string;
  /** The plan it was laid out from, when it came from one. */
  planId: ID | null;
}

/* -------------------------------------------------------------------------
 * Food — what you ate, and what you are going to.
 *
 * Three shapes, and the relationship between them is the whole design:
 *
 *   FoodItem    one ingredient and what it costs
 *   Meal        a named set of items you keep, so you never type it twice
 *   FoodEntry   one line on one day — either a one-off, or a meal LOGGED
 *
 * An entry logged from a meal carries a COPY of that meal's items, not a live
 * reference. Editing "Chicken and rice" to 800 kcal next month must not go
 * back and rewrite what last Tuesday says you ate. `mealId` survives as
 * provenance — it is what "used 14 times" counts — but nothing reads through
 * it for a number.
 * ---------------------------------------------------------------------- */

/**
 * What 100 g of something costs, copied off the packet.
 *
 * All four numbers or none: a partial set would let a meal claim macros it
 * cannot account for, and "0 g of fat" and "we never asked" are very different
 * statements about a spoon of olive oil. `coercePer100` enforces that.
 */
export interface Per100 {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** Protein, fat and carbs in grams. Derived — never stored. */
export interface Macros {
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * One ingredient. kcal is always whole — nobody counts a tenth of a calorie.
 *
 * `grams` and `per100` are both OPTIONAL and absent by default, which is the
 * entire reason this needed no version bump. Every item ever written by an
 * older build is still exactly a valid item, and inventing plausible-looking
 * values for them — 100 g of something at 100 kcal — would have been fiction
 * indistinguishable from measurement the moment it was saved.
 *
 * An ingredient counts as WEIGHED when it has a weight and per-100 g facts with
 * a non-zero kcal — the condition `isWeighed()` in derive.ts states once and
 * everything else defers to. The kcal clause is what makes the editor safe to
 * fill in one field at a time: typing the protein first must not, for the
 * moment before the calories arrive, turn a 300 kcal ingredient into a 0.
 *
 * Once weighed, `calories` stops being an independent fact: it is
 * `per100.kcal × grams ÷ 100`, written through on every edit (see `settleItem`
 * in store.tsx) and re-imposed on load. Storing it rather than deriving it at
 * read is what keeps the four existing places that sum items — the meal total,
 * the entry total, the day and the week — summing plain integers that cannot
 * drift apart from one another by a rounding step.
 */
export interface FoodItem {
  id: ID;
  name: string;
  calories: number;
  order: number;
  /** How much of it went in. Absent when the ingredient was never weighed. */
  grams?: number;
  /** The packet facts. Absent until they are entered; never fabricated. */
  per100?: Per100;
}

export interface Meal {
  id: ID;
  name: string;
  items: FoodItem[];
  order: number;
  createdAt: Timestamp;
}

export interface FoodEntry {
  id: ID;
  date: DayKey;
  name: string;
  /** kcal for the whole line. When `items` is non-empty this is their sum,
   *  kept in step by the store — see `addFood` / `updateFood`. */
  calories: number;
  /** The meal this came from, if any. Provenance only; never read for a total. */
  mealId: ID | null;
  /** The breakdown as it was when this was logged. Empty for a one-off. */
  items: FoodItem[];
  order: number;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------
 * Capture + planning
 * ---------------------------------------------------------------------- */

/** An unprocessed thought. Triaged later into a task, goal or habit. */
export interface InboxItem {
  id: ID;
  text: string;
  createdAt: Timestamp;
}

/** The intention set for a week, keyed by that week's Monday `DayKey`. */
export interface WeekPlan {
  focus: string;
}

/* -------------------------------------------------------------------------
 * Settings + the root document
 * ---------------------------------------------------------------------- */

export interface AssistantSettings {
  /** Used in the greeting. Empty string means "no name yet". */
  userName: string;
  /** Set the first time demo data is loaded, so the empty state stays gone. */
  seededAt: Timestamp | null;
  /** What every `Exercise.load` in the document is counted in. */
  loadUnit: LoadUnit;
  /** kcal/day to aim at. The one number the food view derives the rest from. */
  calorieTarget: number;
}

/** Enough to stay alive and be wrong in a recoverable direction. */
export const DEFAULT_CALORIE_TARGET = 2000;

/** Bump on every breaking shape change and add a case to `migrate()`. */
export const DATA_VERSION = 1;

export interface AssistantData {
  version: number;
  areas: LifeArea[];
  goals: Goal[];
  milestones: Milestone[];
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  reviews: ReviewEntry[];
  inbox: InboxItem[];
  exercises: Exercise[];
  /** Keyed by the day the session falls on. */
  workoutDays: Record<DayKey, WorkoutDay>;
  /** The library — muscle-group days kept for re-use. */
  workoutPlans: WorkoutPlan[];
  food: FoodEntry[];
  /** The library — meals kept for re-use. */
  meals: Meal[];
  /** Keyed by the week's Monday `DayKey`. */
  weeks: Record<DayKey, WeekPlan>;
  settings: AssistantSettings;
}

/** The document a brand-new user starts from. */
export const EMPTY_DATA: AssistantData = {
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
  settings: {
    userName: '',
    seededAt: null,
    loadUnit: 'kg',
    calorieTarget: DEFAULT_CALORIE_TARGET,
  },
};

/* -------------------------------------------------------------------------
 * View model helpers shared across the UI
 * ---------------------------------------------------------------------- */

/** The nine surfaces of the portal. Doubles as the URL hash. */
export type ViewId =
  | 'today'
  | 'week'
  | 'review'
  | 'inbox'
  | 'habits'
  | 'workouts'
  | 'food'
  | 'goals'
  | 'insights';

/**
 * THE canonical order, and the order they appear in the switcher.
 *
 * This is load-bearing in three places: the 1–9 hotkeys index straight into it,
 * the switcher's arrow keys step through it, and the command palette prints the
 * index as each view's shortcut. It drifted out of display order once already,
 * and the symptom was quiet — pressing 2 went to Goals while the tab beside
 * Today said Week, and ArrowRight off Week landed on Inbox. One list now, so
 * they cannot disagree again.
 */
export const VIEW_IDS: ViewId[] = [
  'today',
  'week',
  'review',
  'inbox',
  'habits',
  'workouts',
  'food',
  'goals',
  'insights',
];

/** A goal with its rolled-up progress, as returned by `derive.ts`. */
export interface GoalProgress {
  /** 0–1. */
  ratio: number;
  done: number;
  total: number;
  /** What the ratio was computed from, so the UI can label it honestly. */
  basis: 'milestones' | 'tasks' | 'goals' | 'none';
}

/** A habit's streak state for a given reference day. */
export interface HabitStreak {
  current: number;
  best: number;
  /** True when the habit is due on the reference day and not yet logged. */
  dueToday: boolean;
  /** True when it has already been logged on the reference day. */
  doneToday: boolean;
  /** Total completions ever. */
  total: number;
}
