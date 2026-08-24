/* ---------------------------------------------------------------------------
 * seed.ts — the demo document.
 *
 * This is what the portal looks like on first open, so it has to feel like a
 * system somebody has actually been living in for four months: goals that
 * ladder, milestones half ticked, a training streak, a habit that broke last
 * week, reviews written in a real voice.
 *
 * Two rules keep it honest:
 *   • Everything is built RELATIVE to `todayKey()`, so it is never stale.
 *   • All randomness comes from a seeded LCG and all ids from a counter, so the
 *     same dataset is produced on every machine, on the server and in the
 *     browser, with no dependency on `crypto` or `Math.random` at module scope.
 * ------------------------------------------------------------------------- */

import { addDaysKey, fromKey, isoWeekday, todayKey, weekDaysFrom, weekStartKey } from './dates';
import { caloriesFrom } from './derive';
import {
  DATA_VERSION,
  type AssistantData,
  type DayKey,
  type Exercise,
  type FoodEntry,
  type FoodItem,
  type Meal,
  type PlanExercise,
  type WorkoutDay,
  type WorkoutPlan,
  type Goal,
  type Habit,
  type HabitLog,
  type InboxItem,
  type LifeArea,
  type Milestone,
  type ReviewEntry,
  type Task,
  type Timestamp,
  type WeekPlan,
} from './types';

/* -------------------------------------------------------------------------
 * Deterministic randomness
 * ---------------------------------------------------------------------- */

/** Numerical Recipes LCG — small, stable, good enough for texture. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickFrom<T>(rng: () => number, items: readonly T[], fallback: T): T {
  if (items.length === 0) return fallback;
  return items[Math.floor(rng() * items.length)] ?? fallback;
}

function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
}

/** Deals titles out of a shuffled bag, refilling when it runs dry. */
function dispenser(rng: () => number, titles: readonly string[]): () => string {
  let bag: string[] = [];
  return () => {
    if (bag.length === 0) bag = shuffled(rng, titles);
    return bag.pop() ?? titles[0] ?? 'Untitled';
  };
}

/* -------------------------------------------------------------------------
 * Content
 * ---------------------------------------------------------------------- */

const RUNNING_TASKS = [
  'Easy 8km before work',
  'Threshold intervals — 6×800m',
  'Long run, 16km steady',
  'Strength session: squats and pulls',
  'Mobility routine, 20 minutes',
  'Book the physio check-in',
  'Order the new race shoes',
  'Plan next week’s mileage',
  'Sports massage',
  'Log the week’s training properly',
] as const;

const SHIP_TASKS = [
  'Write the v2 release notes',
  'Fix the onboarding empty state',
  'Record the 90-second demo',
  'Clear the PR review backlog',
  'Draft the pricing page copy',
  'Call three beta accounts',
  'Ship the billing bugfix',
  'Rewrite the marketing hero',
  'Build the launch checklist',
  'Send the beta invite emails',
] as const;

const ONBOARDING_TASKS = [
  'Instrument the signup funnel',
  'Watch two session replays',
  'Cut step four from signup',
  'Prototype the one-click import',
  'Write the empty-state copy',
  'Interview a churned customer',
  'Measure median setup time',
  'Simplify the permissions screen',
] as const;

const WEALTH_TASKS = [
  'Move £1,200 into the index fund',
  'Update the net-worth sheet',
  'Cancel the three dead subscriptions',
  'Read the pension statement properly',
  'Compare the two ISA providers',
  'File the quarter’s receipts',
  'Move the standing order to payday',
] as const;

const PEOPLE_TASKS = [
  'Call Mum',
  'Book dinner with Sam',
  'Send Tom the photos from the weekend',
  'Plan the trip home',
  'Reply to Ella properly',
  'Buy Dad’s birthday present',
  'Sunday walk with Jo',
] as const;

const WRITING_TASKS = [
  'Write 500 words on the essay',
  'Edit the draft down to 900 words',
  'Finish chapter four',
  'Watch module three of the course',
  'Publish the essay',
  'Outline the next two essays',
  'Read for 30 minutes, no phone',
] as const;

const BACKLOG_TASKS = [
  'Research standing desks properly',
  'Draft the 2030 vision letter',
  'Find a Portuguese tutor',
  'Compare income protection cover',
  'Clear the loft',
  'Read Thinking in Systems',
] as const;

const INBOX_THOUGHTS = [
  'Is the 5am thing actually helping, or am I just permanently tired?',
  'Ask Priya how she runs her weekly review — hers seems to stick',
  'Idea: a one-page “state of me” letter I send myself every quarter',
  'Move the savings rate up 2% when the next invoice clears',
] as const;

/* -------------------------------------------------------------------------
 * The build
 * ---------------------------------------------------------------------- */

export function buildSeedData(): AssistantData {
  const rng = makeRng(0x5c17b7);
  let counter = 0;
  const nid = (prefix: string): string => {
    counter += 1;
    return `seed-${prefix}-${counter}`;
  };

  const today = todayKey();
  const day = (offset: number): DayKey => addDaysKey(today, offset);
  const at = (key: DayKey, hour: number, minute = 0): Timestamp => {
    const d = fromKey(key);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  const areas: LifeArea[] = [];
  const goals: Goal[] = [];
  const milestones: Milestone[] = [];
  const tasks: Task[] = [];
  const habits: Habit[] = [];
  const habitLogs: HabitLog[] = [];
  const reviews: ReviewEntry[] = [];
  const inbox: InboxItem[] = [];
  const weeks: Record<DayKey, WeekPlan> = {};

  /* ---------------- life areas ---------------- */

  const mkArea = (name: string, icon: string, color: string): LifeArea => {
    const area: LifeArea = {
      id: nid('area'),
      name,
      icon,
      color,
      order: areas.length,
      createdAt: at(day(-182), 9),
    };
    areas.push(area);
    return area;
  };

  const health = mkArea('Health & Fitness', 'Dumbbell', '#0f9d6e');
  const career = mkArea('Career & Craft', 'Briefcase', '#0099ff');
  const wealth = mkArea('Wealth', 'Wallet', '#b4761f');
  const people = mkArea('Relationships', 'Heart', '#c9564f');
  const mind = mkArea('Mind & Growth', 'Brain', '#7c5cd6');

  /* ---------------- goals ---------------- */

  const mkGoal = (input: {
    area: LifeArea | null;
    title: string;
    why: string;
    horizon: Goal['horizon'];
    parent?: Goal | null;
    targetOffset?: number | null;
    createdOffset: number;
  }): Goal => {
    const goal: Goal = {
      id: nid('goal'),
      areaId: input.area ? input.area.id : null,
      title: input.title,
      why: input.why,
      horizon: input.horizon,
      parentGoalId: input.parent ? input.parent.id : null,
      targetDate: typeof input.targetOffset === 'number' ? day(input.targetOffset) : null,
      status: 'active',
      achievedAt: null,
      order: goals.length,
      createdAt: at(day(input.createdOffset), 8, 30),
    };
    goals.push(goal);
    return goal;
  };

  const visionBody = mkGoal({
    area: health,
    title: 'Be stronger at forty than I was at twenty-five',
    why: 'I want the next thirty years to be a choice rather than a negotiation with my own body. Training now is the cheapest version of that decision I will ever get.',
    horizon: 'vision',
    targetOffset: null,
    createdOffset: -182,
  });

  const visionWork = mkGoal({
    area: career,
    title: 'Own something that keeps working when I close the laptop',
    why: 'Freedom for me is choosing what I work on. That only comes from building a product that earns while I sleep, not from selling more of my hours.',
    horizon: 'vision',
    targetOffset: null,
    createdOffset: -182,
  });

  const yearRun = mkGoal({
    area: health,
    title: 'Run a sub-1:30 half marathon',
    why: 'It is the first goal I have set where talent runs out and only consistency is left. I want to prove to myself that I can hold a plan for a full year.',
    horizon: 'year',
    parent: visionBody,
    targetOffset: 168,
    createdOffset: -175,
  });

  const yearProduct = mkGoal({
    area: career,
    title: 'Take the product to 100 paying customers',
    why: 'One hundred is the number where this stops being a side project and starts being a business I can plan a life around.',
    horizon: 'year',
    parent: visionWork,
    targetOffset: 196,
    createdOffset: -175,
  });

  const yearMoney = mkGoal({
    area: wealth,
    title: 'Reach £100k invested and twelve months of runway',
    why: 'Runway is not about the money. It is about being able to say no to work I do not believe in without checking the balance first.',
    horizon: 'year',
    targetOffset: 210,
    createdOffset: -170,
  });

  const yearMind = mkGoal({
    area: mind,
    title: 'Read 24 books and publish 50 essays',
    why: 'I think better on paper than in my head, and everything good that has happened in the last two years started as something I wrote down in public.',
    horizon: 'year',
    targetOffset: 203,
    createdOffset: -170,
  });

  const qMileage = mkGoal({
    area: health,
    title: 'Hold 45km a week, pain-free, for six straight weeks',
    why: 'Every previous attempt at this ended in an injury from adding mileage too fast. Six boring weeks is the whole point.',
    horizon: 'quarter',
    parent: yearRun,
    targetOffset: 49,
    createdOffset: -63,
  });

  const qLaunch = mkGoal({
    area: career,
    title: 'Ship v2 and onboard the first 25 customers',
    why: 'v1 proved people want this. v2 is where it has to stop being a demo and start being something someone pays for every month.',
    horizon: 'quarter',
    parent: yearProduct,
    targetOffset: 21,
    createdOffset: -70,
  });

  const qOnboarding = mkGoal({
    area: career,
    title: 'Cut onboarding from twenty minutes to five',
    why: 'Two thirds of the people who sign up never finish setup. Every minute I remove is a customer I stop losing before they ever see the value.',
    horizon: 'quarter',
    parent: yearProduct,
    targetOffset: 63,
    createdOffset: -56,
  });

  const qSavings = mkGoal({
    area: wealth,
    title: 'Automate the savings and add £40k invested',
    why: 'If it depends on me remembering, it will not happen in a busy month. I want the system to be boring and automatic by the end of the quarter.',
    horizon: 'quarter',
    parent: yearMoney,
    targetOffset: 77,
    createdOffset: -56,
  });

  const qPeople = mkGoal({
    area: people,
    title: 'See the people I care about twice a month, phone away',
    why: 'I have been treating friendship like something that maintains itself. It does not, and I have felt the difference this year.',
    horizon: 'quarter',
    targetOffset: 56,
    createdOffset: -49,
  });

  const qWriting = mkGoal({
    area: mind,
    title: 'Publish twelve essays and finish the writing course',
    why: 'Publishing is the forcing function — I only find out whether I actually understand something when I have to explain it to a stranger.',
    horizon: 'quarter',
    parent: yearMind,
    targetOffset: 70,
    createdOffset: -49,
  });

  /* ---------------- milestones ---------------- */

  const mkMilestone = (
    goal: Goal,
    title: string,
    targetOffset: number,
    done: boolean,
    completedOffset?: number,
  ): Milestone => {
    const siblings = milestones.filter((m) => m.goalId === goal.id).length;
    const milestone: Milestone = {
      id: nid('milestone'),
      goalId: goal.id,
      title,
      targetDate: day(targetOffset),
      completedAt: done
        ? at(day(completedOffset ?? targetOffset), intBetween(rng, 16, 21), intBetween(rng, 0, 59))
        : null,
      order: siblings,
      createdAt: at(day(Math.max(-90, targetOffset - 35)), 9),
    };
    milestones.push(milestone);
    return milestone;
  };

  mkMilestone(qMileage, 'Rebuild the base back to 30km a week', -28, true, -27);
  mkMilestone(qMileage, 'Six weeks of strength work, no sessions missed', -14, true, -13);
  const msMileage38 = mkMilestone(qMileage, 'First 38km week', 14, false);
  const msMileage45 = mkMilestone(qMileage, 'First 45km week', 35, false);
  mkMilestone(qMileage, 'Two 45km weeks back to back, no niggles', 49, false);

  mkMilestone(qLaunch, 'Design review signed off', -21, true, -20);
  mkMilestone(qLaunch, 'Feature freeze — nothing new goes in', -7, true, -6);
  const msLaunchBeta = mkMilestone(qLaunch, 'Five beta accounts live and using it', 7, false);
  const msLaunchPublic = mkMilestone(qLaunch, 'Public launch', 14, false);
  mkMilestone(qLaunch, '25 paying accounts', 21, false);

  mkMilestone(qOnboarding, 'Every step of the funnel instrumented', -7, true, -8);
  const msOnbCut = mkMilestone(qOnboarding, 'Kill the three steps nobody finishes', 14, false);
  const msOnbImport = mkMilestone(qOnboarding, 'One-click import shipped', 35, false);
  mkMilestone(qOnboarding, 'Median setup under five minutes', 63, false);

  mkMilestone(qSavings, 'Standing order moved to payday', -35, true, -34);
  const msSaveConsolidate = mkMilestone(qSavings, 'Consolidate the two old pensions', 28, false);
  const msSaveRebalance = mkMilestone(qSavings, 'Rebalance to the target split', 49, false);
  mkMilestone(qSavings, '£40k in, verified on the statement', 77, false);

  mkMilestone(qPeople, 'Trip home booked and paid for', -14, true, -12);
  mkMilestone(qPeople, 'Standing Thursday call with Sam', -7, true, -7);
  const msPeopleWeekend = mkMilestone(qPeople, 'Weekend away planned', 28, false);
  mkMilestone(qPeople, 'Dinner with the old team', 56, false);

  mkMilestone(qWriting, 'Course modules one to three', -21, true, -19);
  mkMilestone(qWriting, 'First four essays live', -7, true, -5);
  const msWriteEight = mkMilestone(qWriting, 'Essays five to eight published', 28, false);
  const msWriteCourse = mkMilestone(qWriting, 'Finish the course', 49, false);
  mkMilestone(qWriting, 'Twelve essays live', 70, false);

  /* ---------------- task pools ---------------- */

  interface Pool {
    goal: Goal;
    next: () => string;
    milestones: Milestone[];
  }

  const poolRun: Pool = {
    goal: qMileage,
    next: dispenser(rng, RUNNING_TASKS),
    milestones: [msMileage38, msMileage45],
  };
  const poolShip: Pool = {
    goal: qLaunch,
    next: dispenser(rng, SHIP_TASKS),
    milestones: [msLaunchBeta, msLaunchPublic],
  };
  const poolOnboard: Pool = {
    goal: qOnboarding,
    next: dispenser(rng, ONBOARDING_TASKS),
    milestones: [msOnbCut, msOnbImport],
  };
  const poolMoney: Pool = {
    goal: qSavings,
    next: dispenser(rng, WEALTH_TASKS),
    milestones: [msSaveConsolidate, msSaveRebalance],
  };
  const poolPeople: Pool = {
    goal: qPeople,
    next: dispenser(rng, PEOPLE_TASKS),
    milestones: [msPeopleWeekend],
  };
  const poolWrite: Pool = {
    goal: qWriting,
    next: dispenser(rng, WRITING_TASKS),
    milestones: [msWriteEight, msWriteCourse],
  };

  // Weekdays lean toward work, weekends toward everything else.
  const weekdayPools = [poolShip, poolShip, poolRun, poolOnboard, poolMoney, poolWrite];
  const weekendPools = [poolRun, poolPeople, poolWrite, poolMoney];

  const orderPerDay = new Map<string, number>();
  const nextOrder = (key: DayKey | null): number => {
    const bucket = key ?? '__backlog__';
    const value = orderPerDay.get(bucket) ?? 0;
    orderPerDay.set(bucket, value + 1);
    return value;
  };

  const mkTask = (input: {
    title: string;
    scheduledFor: DayKey | null;
    goal?: Goal | null;
    milestone?: Milestone | null;
    completedAt?: Timestamp | null;
    big3Rank?: 1 | 2 | 3 | null;
    carryCount?: number;
    createdAt?: Timestamp;
  }): Task => {
    const task: Task = {
      id: nid('task'),
      title: input.title,
      notes: '',
      goalId: input.goal ? input.goal.id : input.milestone ? input.milestone.goalId : null,
      milestoneId: input.milestone ? input.milestone.id : null,
      scheduledFor: input.scheduledFor,
      big3Rank: input.big3Rank ?? null,
      completedAt: input.completedAt ?? null,
      carryCount: input.carryCount ?? 0,
      order: nextOrder(input.scheduledFor),
      createdAt:
        input.createdAt ??
        (input.scheduledFor ? at(input.scheduledFor, 7, 40) : at(day(-20), 12)),
    };
    tasks.push(task);
    return task;
  };

  /* ---------------- the past three weeks ---------------- */

  for (let offset = -21; offset <= -1; offset += 1) {
    const key = day(offset);
    const weekend = isoWeekday(key) >= 6;
    const count = weekend
      ? pickFrom(rng, [0, 1, 1] as const, 1)
      : pickFrom(rng, [1, 1, 2, 2, 3] as const, 2);

    for (let i = 0; i < count; i += 1) {
      const pool = weekend
        ? pickFrom(rng, weekendPools, poolRun)
        : pickFrom(rng, weekdayPools, poolShip);
      const milestone = rng() < 0.45 ? pickFrom(rng, pool.milestones, pool.milestones[0] ?? msLaunchBeta) : null;
      // Older weeks are settled; the last few days still have loose ends.
      const complete = offset <= -8 ? true : rng() > 0.12;
      mkTask({
        title: pool.next(),
        scheduledFor: key,
        goal: pool.goal,
        milestone,
        completedAt: complete ? at(key, intBetween(rng, 9, 20), intBetween(rng, 0, 59)) : null,
      });
    }
  }

  // A few deliberate stragglers, so the carry-over affordance has a job to do.
  mkTask({
    title: 'Rewrite the marketing hero',
    scheduledFor: day(-5),
    goal: qLaunch,
    milestone: msLaunchPublic,
    carryCount: 3,
    createdAt: at(day(-12), 9),
  });
  mkTask({
    title: 'Compare the two ISA providers',
    scheduledFor: day(-3),
    goal: qSavings,
    carryCount: 2,
    createdAt: at(day(-9), 9),
  });
  mkTask({
    title: 'Book the physio check-in',
    scheduledFor: day(-2),
    goal: qMileage,
    carryCount: 2,
    createdAt: at(day(-8), 9),
  });

  /* ---------------- today ---------------- */

  mkTask({
    title: 'Ship the billing bugfix',
    scheduledFor: today,
    goal: qLaunch,
    milestone: msLaunchBeta,
    big3Rank: 1,
    createdAt: at(day(-1), 21, 10),
  });
  mkTask({
    title: 'Threshold intervals — 6×800m',
    scheduledFor: today,
    goal: qMileage,
    milestone: msMileage38,
    big3Rank: 2,
    completedAt: at(today, 7, 5),
    createdAt: at(day(-1), 21, 10),
  });
  mkTask({
    title: 'Write 500 words on the essay',
    scheduledFor: today,
    goal: qWriting,
    milestone: msWriteEight,
    big3Rank: 3,
    createdAt: at(day(-1), 21, 10),
  });
  mkTask({
    title: 'Clear the PR review backlog',
    scheduledFor: today,
    goal: qLaunch,
    completedAt: at(today, 9, 40),
  });
  mkTask({ title: 'Call Mum', scheduledFor: today, goal: qPeople });
  mkTask({ title: 'Move £1,200 into the index fund', scheduledFor: today, goal: qSavings });
  mkTask({
    title: 'Watch two session replays',
    scheduledFor: today,
    goal: qOnboarding,
    milestone: msOnbCut,
  });

  /* ---------------- the days ahead ---------------- */

  for (let offset = 1; offset <= 4; offset += 1) {
    const key = day(offset);
    const weekend = isoWeekday(key) >= 6;
    const count = weekend ? intBetween(rng, 1, 2) : intBetween(rng, 2, 4);
    for (let i = 0; i < count; i += 1) {
      const pool = weekend
        ? pickFrom(rng, weekendPools, poolPeople)
        : pickFrom(rng, weekdayPools, poolShip);
      const milestone = rng() < 0.5 ? pickFrom(rng, pool.milestones, pool.milestones[0] ?? msLaunchBeta) : null;
      mkTask({
        title: pool.next(),
        scheduledFor: key,
        goal: pool.goal,
        milestone,
        createdAt: at(day(-1), 20),
      });
    }
  }

  mkTask({
    title: 'Public launch — go / no-go call',
    scheduledFor: day(7),
    goal: qLaunch,
    milestone: msLaunchPublic,
    createdAt: at(day(-4), 11),
  });
  mkTask({
    title: 'Long run, 18km',
    scheduledFor: day(7),
    goal: qMileage,
    milestone: msMileage45,
    createdAt: at(day(-4), 11),
  });
  mkTask({
    title: 'Consolidate the two old pensions',
    scheduledFor: day(10),
    goal: qSavings,
    milestone: msSaveConsolidate,
    createdAt: at(day(-4), 11),
  });

  /* ---------------- backlog ---------------- */

  // Some backlog items are filed, some are still just thoughts with a verb.
  const backlogGoals: (Goal | null)[] = [null, null, qWriting, qSavings, null, qWriting];
  BACKLOG_TASKS.forEach((title, index) => {
    mkTask({
      title,
      scheduledFor: null,
      goal: backlogGoals[index] ?? null,
      createdAt: at(day(-18 + index * 2), 12, 20),
    });
  });

  /* ---------------- habits ---------------- */

  const mkHabit = (input: {
    name: string;
    icon: string;
    area: LifeArea | null;
    goal: Goal | null;
    cadence: Habit['cadence'];
    createdOffset: number;
  }): Habit => {
    const habit: Habit = {
      id: nid('habit'),
      name: input.name,
      icon: input.icon,
      areaId: input.area ? input.area.id : null,
      goalId: input.goal ? input.goal.id : null,
      cadence: input.cadence,
      order: habits.length,
      createdAt: at(day(input.createdOffset), 7),
      archivedAt: null,
    };
    habits.push(habit);
    return habit;
  };

  const logged = new Set<string>();
  const log = (habit: Habit, key: DayKey): void => {
    const token = `${habit.id}|${key}`;
    if (logged.has(token)) return;
    logged.add(token);
    habitLogs.push({ habitId: habit.id, date: key });
  };

  const HISTORY = 126; // eighteen weeks — enough to fill a heatmap

  const hMove = mkHabit({
    name: 'Move for 30 minutes',
    icon: 'Activity',
    area: health,
    goal: yearRun,
    cadence: { type: 'daily' },
    createdOffset: -(HISTORY + 4),
  });
  const hStrength = mkHabit({
    name: 'Strength session',
    icon: 'Dumbbell',
    area: health,
    goal: qMileage,
    cadence: { type: 'weekdays', days: [1, 3, 5] },
    createdOffset: -(HISTORY + 4),
  });
  const hDeepWork = mkHabit({
    name: 'Two-hour deep work block',
    icon: 'Zap',
    area: career,
    goal: yearProduct,
    cadence: { type: 'weekdays', days: [1, 2, 3, 4, 5] },
    createdOffset: -(HISTORY + 4),
  });
  const hRead = mkHabit({
    name: 'Read 20 pages',
    icon: 'BookOpen',
    area: mind,
    goal: yearMind,
    cadence: { type: 'daily' },
    createdOffset: -(HISTORY + 4),
  });
  const hWrite = mkHabit({
    name: 'Write 500 words',
    icon: 'Sparkles',
    area: mind,
    goal: qWriting,
    cadence: { type: 'timesPerWeek', target: 4 },
    createdOffset: -(HISTORY + 4),
  });
  const hLights = mkHabit({
    name: 'Lights out by eleven',
    icon: 'Moon',
    area: health,
    goal: null,
    cadence: { type: 'timesPerWeek', target: 5 },
    createdOffset: -5,
  });

  // Movement: patchy early, then a long unbroken run right up to today.
  for (let offset = -HISTORY; offset <= 0; offset += 1) {
    const key = day(offset);
    if (offset >= -41 || rng() < 0.74) log(hMove, key);
  }

  // Strength: Mon/Wed/Fri, near-perfect for the last month, today still to do.
  for (let offset = -HISTORY; offset <= -1; offset += 1) {
    const key = day(offset);
    if (![1, 3, 5].includes(isoWeekday(key))) continue;
    if (offset >= -28 || rng() < 0.8) log(hStrength, key);
  }

  // Deep work: a long run that broke ten days ago and is being rebuilt.
  for (let offset = -HISTORY; offset <= -1; offset += 1) {
    const key = day(offset);
    if (isoWeekday(key) > 5) continue;
    if (offset >= -12 && offset <= -8) continue; // the week it fell apart
    if (offset >= -7 || rng() < 0.86) log(hDeepWork, key);
  }

  // Reading: honest gaps, done already today.
  for (let offset = -HISTORY; offset <= 0; offset += 1) {
    if (offset === 0 || rng() < 0.66) log(hRead, day(offset));
  }

  // Writing: four times a week, hit reliably for the last six weeks.
  let week = weekStartKey(day(-HISTORY));
  const thisWeek = weekStartKey(today);
  while (week <= thisWeek) {
    const isCurrent = week === thisWeek;
    const weeksAgo = Math.round((fromKey(thisWeek).getTime() - fromKey(week).getTime()) / 604800000);
    const target = isCurrent ? 2 : weeksAgo <= 6 ? intBetween(rng, 4, 5) : intBetween(rng, 2, 5);
    const candidates = shuffled(rng, weekDaysFrom(week)).filter((k) => k <= today);
    candidates.slice(0, target).forEach((k) => log(hWrite, k));
    week = addDaysKey(week, 7);
  }

  // Lights out: five days old, three logs, no streak yet.
  log(hLights, day(-4));
  log(hLights, day(-3));
  log(hLights, day(-1));

  /* ---------------- reviews ---------------- */

  const mkReview = (input: {
    type: ReviewEntry['type'];
    date: DayKey;
    rating: number | null;
    reflections: ReviewEntry['reflections'];
    tomorrowBig3?: string[];
    nextWeekFocus?: string;
    createdAt: Timestamp;
  }): ReviewEntry => {
    const entry: ReviewEntry = {
      id: nid('review'),
      type: input.type,
      date: input.date,
      rating: input.rating,
      reflections: input.reflections,
      createdAt: input.createdAt,
    };
    if (input.tomorrowBig3) entry.tomorrowBig3 = input.tomorrowBig3;
    if (input.nextWeekFocus) entry.nextWeekFocus = input.nextWeekFocus;
    reviews.push(entry);
    return entry;
  };

  mkReview({
    type: 'daily',
    date: day(-1),
    rating: 4,
    reflections: {
      wins: 'Got the billing work to the point where only the fix is left. Ran the 6×800m session properly instead of talking myself into an easy run.',
      challenges: 'Lost most of the afternoon to Slack. The deep work block was the first thing I gave away when the day got busy, which is exactly backwards.',
      lessons: 'The block has to go in before anything else can claim the time. If it is not on the calendar by Sunday night it does not survive Tuesday.',
      gratitude: 'Sam calling out of nowhere. Twenty minutes and the whole day felt lighter.',
    },
    tomorrowBig3: [
      'Ship the billing bugfix',
      'Threshold intervals — 6×800m',
      'Write 500 words on the essay',
    ],
    createdAt: at(day(-1), 21, 30),
  });

  mkReview({
    type: 'daily',
    date: day(-2),
    rating: 3,
    reflections: {
      wins: 'Cleared the review backlog and shipped the empty-state copy. Small, but the app stops feeling unfinished.',
      challenges: 'Skipped the physio call again. It has been sitting there three days and it takes four minutes.',
      lessons: 'Anything that needs a phone call gets avoided. Batch them into one slot rather than scattering them.',
      gratitude: 'The evening walk. First clear sky in a week.',
    },
    createdAt: at(day(-2), 22, 5),
  });

  mkReview({
    type: 'daily',
    date: day(-3),
    rating: 5,
    reflections: {
      wins: 'Best day in a fortnight. Three hours uninterrupted on the import prototype and it actually works end to end.',
      challenges: 'Ate badly around it — worked through lunch and paid for it at four.',
      lessons: 'Deep work is not the constraint. Protecting the hour either side of it is.',
      gratitude: 'That the hard part turned out to be easier than the fear of it.',
    },
    createdAt: at(day(-3), 21, 15),
  });

  mkReview({
    type: 'daily',
    date: day(-4),
    rating: 3,
    reflections: {
      wins: 'Long run done before the day started. Legs held up at 16km, which they would not have six weeks ago.',
      challenges: 'Reactive all afternoon. Answered everything, finished nothing.',
      lessons: 'A day with no Big Three set is a day that gets spent by other people.',
      gratitude: 'Cold morning, empty park, no phone.',
    },
    createdAt: at(day(-4), 22, 40),
  });

  mkReview({
    type: 'daily',
    date: day(-5),
    rating: 4,
    reflections: {
      wins: 'Two beta calls booked and the launch checklist written down instead of living in my head.',
      challenges: 'Kept reopening the pricing page copy. Fourth draft is not better than the second.',
      lessons: 'Ship the second draft and let a customer tell me what is wrong with it.',
      gratitude: 'Dad sounding genuinely well on the phone.',
    },
    createdAt: at(day(-5), 21, 50),
  });

  mkReview({
    type: 'daily',
    date: day(-6),
    rating: 2,
    reflections: {
      wins: 'Showed up for the strength session even though nothing else went right.',
      challenges: 'Slept badly, started late, and let the whole day drift. Nothing that mattered moved.',
      lessons: 'The 11pm rule is not optional. Every bad day this month started the night before.',
      gratitude: 'That a bad day is now unusual enough to be worth writing about.',
    },
    createdAt: at(day(-6), 23, 10),
  });

  const lastWeekMonday = weekStartKey(day(-7));
  const twoWeeksMonday = weekStartKey(day(-14));

  const thisWeekFocus =
    'Get v2 in front of the first five beta accounts, and keep the mileage boring.';
  const lastWeekFocus = 'Feature freeze. Nothing new goes in — finish what is already open.';
  const twoWeeksFocus = 'Rebuild the training base and clear everything owed to other people.';

  mkReview({
    type: 'weekly',
    date: lastWeekMonday,
    rating: 4,
    reflections: {
      wins: 'Feature freeze held, which it never has before. Four essays are live and the training weeks are stacking without anything hurting.',
      challenges: 'The deep work streak broke mid-week and I did not notice until it was three days gone. Onboarding work slipped behind the launch work again.',
      lessons: 'Two quarter goals competing for the same mornings means one of them quietly loses. Launch gets the mornings until it ships, and I should stop pretending otherwise.',
      gratitude: 'The people who agreed to be beta accounts without being asked twice.',
    },
    nextWeekFocus: thisWeekFocus,
    createdAt: at(day(-6), 9, 20),
  });

  mkReview({
    type: 'weekly',
    date: twoWeeksMonday,
    rating: 3,
    reflections: {
      wins: 'Base mileage back to 30km with no soreness, and the pension paperwork finally off the pile.',
      challenges: 'Said yes to two things I did not want to do, and both ate an evening I had set aside for writing.',
      lessons: 'The cost of a yes is never the hour it takes — it is the thing it quietly replaces.',
      gratitude: 'A whole Saturday with no plans and no guilt about it.',
    },
    nextWeekFocus: lastWeekFocus,
    createdAt: at(day(-13), 9, 40),
  });

  weeks[thisWeek] = { focus: thisWeekFocus };
  weeks[lastWeekMonday] = { focus: lastWeekFocus };
  weeks[twoWeeksMonday] = { focus: twoWeeksFocus };

  /* ---------------- inbox ---------------- */

  INBOX_THOUGHTS.forEach((text, index) => {
    inbox.push({
      id: nid('inbox'),
      text,
      createdAt: at(day(-index - 1), intBetween(rng, 8, 22), intBetween(rng, 0, 59)),
    });
  });

  /* ---------------- training ----------------
   * An upper/lower split run three days a week, two weeks deep, with the loads
   * creeping up week on week — which is the only thing a log is really for.
   * Days are placed relative to each week's Monday rather than to `today`, so
   * the demo shows a full week whichever day it is loaded on. */

  const exercises: Exercise[] = [];
  const workoutDays: Record<DayKey, WorkoutDay> = {};
  const workoutPlans: WorkoutPlan[] = [];

  /** A muscle-group day in the plan library. */
  const mkPlan = (name: string, items: readonly [string, number, number, number][]): WorkoutPlan => {
    const plan: WorkoutPlan = {
      id: nid('plan'),
      name,
      items: items.map(([itemName, sets, reps, load], index) => ({
        id: nid('pex'),
        name: itemName,
        sets,
        reps,
        load,
        order: index,
      })),
      order: workoutPlans.length,
      createdAt: at(day(-60), 9),
    };
    workoutPlans.push(plan);
    return plan;
  };

  const mkSession = (
    date: DayKey,
    plan: WorkoutPlan,
    items: readonly [string, number, number, number][],
  ): void => {
    workoutDays[date] = { name: plan.name, planId: plan.id };
    items.forEach(([name, sets, reps, load], index) => {
      exercises.push({
        id: nid('ex'),
        date,
        name,
        load,
        sets,
        reps,
        // Anything in the past was done; anything still ahead is a plan.
        completedAt: date < today ? at(date, 19, 30) : null,
        planId: plan.id,
        order: index,
        createdAt: at(date, 7, 0),
      });
    });
  };

  /** Last week's numbers, plus a step. */
  const step = (plan: readonly [string, number, number, number][], by: number) =>
    plan.map(([name, sets, reps, load]) => [name, sets, reps, load + by] as const) as readonly [
      string,
      number,
      number,
      number,
    ][];

  const LOWER: readonly [string, number, number, number][] = [
    ['Back squat', 4, 5, 90],
    ['Romanian deadlift', 3, 8, 70],
    ['Walking lunge', 3, 10, 20],
    ['Calf raise', 3, 12, 40],
  ];
  const UPPER: readonly [string, number, number, number][] = [
    ['Bench press', 4, 5, 70],
    ['Barbell row', 4, 6, 60],
    ['Overhead press', 3, 8, 40],
    ['Chin-up', 3, 6, 0],
  ];
  const POSTERIOR: readonly [string, number, number, number][] = [
    ['Deadlift', 3, 5, 120],
    ['Front squat', 3, 6, 60],
    ['Hip thrust', 3, 10, 80],
    ['Face pull', 3, 15, 25],
  ];

  /* Monday / Wednesday / Friday of the last three weeks — the week before last
   * lighter, this week heavier, so the trend is visible in one glance. */
  /* The three plans, written with the loads they STARTED at. What lands on a
   * day comes from the last time that plan was run — see `applyPlan`. */
  const LEG_DAY = mkPlan('Leg day', LOWER);
  const PUSH_PULL = mkPlan('Push & pull', UPPER);
  const POSTERIOR_DAY = mkPlan('Posterior chain', POSTERIOR);

  ([
    [twoWeeksMonday, -5],
    [lastWeekMonday, 0],
    [thisWeek, 5],
  ] as const).forEach(([monday, offset]) => {
    mkSession(addDaysKey(monday, 0), LEG_DAY, step(LOWER, offset));
    mkSession(addDaysKey(monday, 2), PUSH_PULL, step(UPPER, offset));
    mkSession(addDaysKey(monday, 4), POSTERIOR_DAY, step(POSTERIOR, offset));
  });

  /* ---------------- food ----------------
   * Six days back plus today, so the week strip has bars in it and the average
   * has something honest to divide by. Today's is left part-logged, which is
   * what an afternoon actually looks like. */

  const food: FoodEntry[] = [];
  const meals: Meal[] = [];

  /** An ingredient as the seed describes one, before it is given an identity. */
  type SeedIngredient = Omit<FoodItem, 'id' | 'order'>;

  /**
   * An ingredient with the packet on it: a weight and the facts for 100 g.
   *
   * The calorie figure is computed here rather than written down, through the
   * same `caloriesFrom` the store and the repo use. That shared call is not
   * tidiness: `loadSeed` dispatches a `replace` and never passes through
   * `migrate()`, so these values go straight to storage and are read back by
   * the repo on the next reload — and while the seed rounded one way and the
   * repo the other, four of the twelve ingredients here changed by a calorie
   * the first time the page was refreshed.
   *
   * The numbers are real. Olive oil is 884 kcal per 100 g, not a round 100 per
   * tablespoon, and a demo that rounds the facts teaches the wrong arithmetic
   * the first time somebody checks one against a label.
   */
  const weighed = (
    name: string,
    grams: number,
    [kcal, protein, fat, carbs]: readonly [number, number, number, number],
  ): SeedIngredient => ({
    name,
    grams,
    per100: { kcal, protein, fat, carbs },
    calories: caloriesFrom(grams, kcal),
  });

  /** An ingredient nobody weighs: a mixture, a splash of something, a menu item. */
  const flat = (name: string, calories: number): SeedIngredient => ({ name, calories });

  /** A saved meal, built from its ingredients. */
  const mkMeal = (name: string, parts: readonly SeedIngredient[]): Meal => {
    const meal: Meal = {
      id: nid('meal'),
      name,
      items: parts.map((part, index) => ({ ...part, id: nid('item'), order: index })),
      order: meals.length,
      createdAt: at(day(-40), 19),
    };
    meals.push(meal);
    return meal;
  };

  /* Deliberately mixed. Most ingredients carry their facts, and one or two in
     each meal do not — that IS the shape of a real meal, and it is what the
     macro line under the totals is built to be honest about. */
  const CHICKEN_BOWL = mkMeal('Chicken and rice bowl', [
    weighed('Chicken breast', 200, [165, 31, 3.6, 0]),
    weighed('Basmati rice, cooked', 150, [130, 2.7, 0.3, 28]),
    flat('Broccoli and peppers', 90),
    weighed('Olive oil', 11, [884, 0, 100, 0]),
  ]);
  const OVERNIGHT_OATS = mkMeal('Overnight oats', [
    weighed('Rolled oats', 80, [379, 13.2, 6.5, 67.7]),
    weighed('Greek yoghurt', 150, [59, 10, 0.4, 3.6]),
    weighed('Blueberries', 100, [57, 0.7, 0.3, 14.5]),
    weighed('Honey', 21, [304, 0.3, 0, 82.4]),
  ]);
  const SALMON_DINNER = mkMeal('Salmon, potatoes and greens', [
    weighed('Salmon fillet', 180, [208, 20, 13, 0]),
    weighed('New potatoes, boiled', 250, [87, 1.9, 0.1, 20]),
    flat('Green beans and spinach', 70),
    flat('Butter and lemon', 90),
  ]);
  mkMeal('Post-gym shake', [
    weighed('Whey', 30, [400, 80, 7, 7]),
    weighed('Whole milk', 300, [61, 3.2, 3.3, 4.8]),
    weighed('Banana', 110, [89, 1.1, 0.3, 22.8]),
  ]);

  /** A one-off line — what most of a logged day actually is. */
  const mkDayOfFood = (date: DayKey, plan: readonly [string, number][]): void => {
    plan.forEach(([name, calories], index) => {
      food.push({
        id: nid('food'),
        date,
        name,
        calories,
        mealId: null,
        items: [],
        order: index,
        createdAt: at(date, 8 + index * 4, intBetween(rng, 0, 55)),
      });
    });
  };

  /** A saved meal, put on a day — the copy a real log carries. */
  const logMeal = (date: DayKey, meal: Meal, hour: number): void => {
    food.push({
      id: nid('food'),
      date,
      name: meal.name,
      calories: meal.items.reduce((total, item) => total + item.calories, 0),
      mealId: meal.id,
      items: meal.items.map((item, index) => ({ ...item, id: nid('item'), order: index })),
      order: food.filter((f) => f.date === date).length,
      createdAt: at(date, hour, intBetween(rng, 0, 55)),
    });
  };

  const BREAKFASTS: readonly (readonly [string, number])[] = [
    ['Greek yoghurt, berries and honey', 380],
    ['Three eggs on sourdough', 520],
    ['Porridge with banana and peanut butter', 610],
  ];
  const LUNCHES: readonly (readonly [string, number])[] = [
    ['Chicken and rice bowl', 720],
    ['Tuna salad and a flatbread', 560],
    ['Leftover chilli', 640],
  ];
  const DINNERS: readonly (readonly [string, number])[] = [
    ['Salmon, potatoes and greens', 780],
    ['Steak stir fry', 690],
    ['Pasta with turkey ragu', 850],
  ];
  const EXTRAS: readonly (readonly [string, number])[] = [
    ['Protein shake', 210],
    ['Flat white and a banana', 190],
    ['Dark chocolate', 160],
  ];

  for (let back = 6; back >= 1; back -= 1) {
    const date = day(-back);
    mkDayOfFood(date, [
      pickFrom(rng, BREAKFASTS, BREAKFASTS[0]),
      pickFrom(rng, LUNCHES, LUNCHES[0]),
      pickFrom(rng, DINNERS, DINNERS[0]),
      pickFrom(rng, EXTRAS, EXTRAS[0]),
    ] as [string, number][]);
  }

  // Today: breakfast and lunch in, dinner still to come.
  mkDayOfFood(today, [
    ['Greek yoghurt, berries and honey', 380],
    ['Flat white and a banana', 190],
  ]);
  logMeal(today, CHICKEN_BOWL, 13);

  /* And the two days AHEAD, already planned — which is the whole point of
   * keeping meals. A future day with food on it is a prep list, not a log. */
  logMeal(day(1), OVERNIGHT_OATS, 8);
  logMeal(day(1), CHICKEN_BOWL, 13);
  logMeal(day(1), SALMON_DINNER, 19);
  logMeal(day(2), OVERNIGHT_OATS, 8);
  logMeal(day(2), CHICKEN_BOWL, 13);

  /* ---------------- done ---------------- */

  return {
    version: DATA_VERSION,
    areas,
    goals,
    milestones,
    tasks,
    habits,
    habitLogs,
    reviews,
    inbox,
    exercises,
    workoutDays,
    workoutPlans,
    food,
    meals,
    weeks,
    settings: {
      userName: 'Arian',
      seededAt: new Date().toISOString(),
      loadUnit: 'kg',
      calorieTarget: 2400,
    },
  };
}
