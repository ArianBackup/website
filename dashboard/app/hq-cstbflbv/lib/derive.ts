/* ---------------------------------------------------------------------------
 * derive.ts — every number the UI shows, computed from the document.
 *
 * Nothing here mutates, nothing here reaches for the clock unless a caller
 * omits a reference day, and nothing here throws on a dangling id: a task that
 * points at a deleted goal simply has no goal. Progress is always derived and
 * never stored, so a document can be edited by hand and still add up.
 * ------------------------------------------------------------------------- */

import {
  addDaysKey,
  daysBetween,
  formatKey,
  isoWeekday,
  lastNDays,
  toKey,
  todayKey,
  weekDaysFrom,
  weekStartKey,
} from './dates';
import type {
  AssistantData,
  DayKey,
  Exercise,
  FoodEntry,
  FoodItem,
  Meal,
  PlanExercise,
  WorkoutPlan,
  Goal,
  GoalProgress,
  Habit,
  HabitLog,
  HabitStreak,
  ID,
  LifeArea,
  Macros,
  Milestone,
  Task,
  Timestamp,
} from './types';

/** Nobody's streak needs more than two years of history behind it. */
const MAX_SCAN_DAYS = 730;

/** Colour for work that isn't filed under any life area. */
const UNASSIGNED_COLOR = '#93a6c9';

/* -------------------------------------------------------------------------
 * Small shared helpers
 * ---------------------------------------------------------------------- */

/** The LOCAL day an ISO timestamp fell on, or `null` if it is unusable. */
function timestampDay(ts: Timestamp | null | undefined): DayKey | null {
  if (typeof ts !== 'string' || ts.length === 0) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return toKey(d);
}

function byOrder<T extends { order: number; createdAt: Timestamp }>(a: T, b: T): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

function isComplete(task: Task): boolean {
  return typeof task.completedAt === 'string' && task.completedAt.length > 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * One decimal place — the resolution macros are printed on a packet at, and the
 * only one worth carrying: 31.2 g of protein is a fact, 31.19999999999999 is a
 * float. Applied at every step of a sum rather than only at the end, so what is
 * displayed for a row and what is displayed for its total agree.
 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* -------------------------------------------------------------------------
 * Goals
 * ---------------------------------------------------------------------- */

/** Goals still being pursued, in the order the owner arranged them. */
export function activeGoals(data: AssistantData): Goal[] {
  return data.goals.filter((g) => g.status === 'active').sort(byOrder);
}

export function goalMilestones(data: AssistantData, goalId: ID): Milestone[] {
  return data.milestones.filter((m) => m.goalId === goalId).sort(byOrder);
}

/** Tasks hanging off the goal directly, plus everything on its milestones. */
export function goalTasks(data: AssistantData, goalId: ID): Task[] {
  const milestoneIds = new Set(
    data.milestones.filter((m) => m.goalId === goalId).map((m) => m.id),
  );
  return data.tasks
    .filter(
      (t) =>
        t.goalId === goalId || (t.milestoneId !== null && milestoneIds.has(t.milestoneId)),
    )
    .sort(byOrder);
}

/**
 * Progress rolls up from whatever the goal actually has:
 * milestones when it has any, otherwise its linked tasks, otherwise nothing —
 * and the `basis` says which, so the UI can label the number honestly.
 */
export function goalProgress(data: AssistantData, goalId: ID): GoalProgress {
  return goalProgressInner(data, goalId, new Set());
}

/**
 * `seen` guards the walk down to child goals: a goal that (through bad data)
 * ends up its own ancestor would otherwise recurse forever.
 */
function goalProgressInner(data: AssistantData, goalId: ID, seen: Set<ID>): GoalProgress {
  if (seen.has(goalId)) return { ratio: 0, done: 0, total: 0, basis: 'none' };
  seen.add(goalId);

  const milestones = goalMilestones(data, goalId);
  if (milestones.length > 0) {
    const done = milestones.filter((m) => Boolean(m.completedAt)).length;
    return { ratio: done / milestones.length, done, total: milestones.length, basis: 'milestones' };
  }

  const tasks = goalTasks(data, goalId);
  if (tasks.length > 0) {
    const done = tasks.filter(isComplete).length;
    return { ratio: done / tasks.length, done, total: tasks.length, basis: 'tasks' };
  }

  /* Nothing directly under it — but a vision goal is not "0 % done" when the
   * quarter goals laddering up to it are half finished. Roll those up, so the
   * cascade reads top-down the way it was planned bottom-up. `done` counts the
   * children that are fully complete; the ratio is their mean progress, which
   * is the honest number even when none is finished outright. */
  const children = data.goals.filter(
    (g) => g.parentGoalId === goalId && g.status !== 'archived',
  );
  if (children.length > 0) {
    const ratios = children.map((child) =>
      child.status === 'achieved' ? 1 : goalProgressInner(data, child.id, seen).ratio,
    );
    const sum = ratios.reduce((total, ratio) => total + ratio, 0);
    return {
      ratio: clamp01(sum / children.length),
      done: ratios.filter((ratio) => ratio >= 1).length,
      total: children.length,
      basis: 'goals',
    };
  }

  return { ratio: 0, done: 0, total: 0, basis: 'none' };
}

/**
 * An area's progress is the mean progress of the goals filed under it.
 *
 * `goals` counts every live goal in the area, but the mean is taken only over
 * the ones that can actually be measured — a ten-year vision with nothing
 * broken out under it yet is not 0 % done, it is unmeasured, and letting it
 * count as zero would make every ambitious area look like a failing one.
 * Achieved goals count as fully done however they got there.
 */
export function areaProgress(data: AssistantData, areaId: ID): { ratio: number; goals: number } {
  const live = data.goals.filter((g) => g.areaId === areaId && g.status !== 'archived');
  if (live.length === 0) return { ratio: 0, goals: 0 };

  const measured: number[] = [];
  for (const goal of live) {
    if (goal.status === 'achieved') {
      measured.push(1);
      continue;
    }
    const progress = goalProgress(data, goal.id);
    if (progress.basis !== 'none') measured.push(progress.ratio);
  }

  if (measured.length === 0) return { ratio: 0, goals: live.length };
  const total = measured.reduce((sum, ratio) => sum + ratio, 0);
  return { ratio: clamp01(total / measured.length), goals: live.length };
}

/** Walks a task back up the cascade. Any link may be missing. */
export function goalTrace(
  data: AssistantData,
  task: Task,
): { goal: Goal | null; milestone: Milestone | null; area: LifeArea | null } {
  const milestone = task.milestoneId
    ? data.milestones.find((m) => m.id === task.milestoneId) ?? null
    : null;
  const goalId = task.goalId ?? milestone?.goalId ?? null;
  const goal = goalId ? data.goals.find((g) => g.id === goalId) ?? null : null;
  const area = goal?.areaId ? data.areas.find((a) => a.id === goal.areaId) ?? null : null;
  return { goal, milestone, area };
}

/* -------------------------------------------------------------------------
 * Tasks
 * ---------------------------------------------------------------------- */

/** A day's tasks: the Big Three first in rank order, then everything else. */
export function tasksForDay(data: AssistantData, day: DayKey): Task[] {
  return data.tasks
    .filter((t) => t.scheduledFor === day)
    .sort((a, b) => {
      const ra = a.big3Rank ?? 4;
      const rb = b.big3Rank ?? 4;
      if (ra !== rb) return ra - rb;
      return byOrder(a, b);
    });
}

/** Unscheduled work still to do. Completed strays are not backlog. */
export function backlogTasks(data: AssistantData): Task[] {
  return data.tasks.filter((t) => t.scheduledFor === null && !isComplete(t)).sort(byOrder);
}

/** Unfinished tasks whose day has already passed, oldest first. */
export function overdueTasks(data: AssistantData, refDay: DayKey): Task[] {
  return data.tasks
    .filter((t) => t.scheduledFor !== null && t.scheduledFor < refDay && !isComplete(t))
    .sort((a, b) => {
      const sa = a.scheduledFor ?? '';
      const sb = b.scheduledFor ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
      return byOrder(a, b);
    });
}

/** Always three slots. `null` means that slot is still free. */
export function big3ForDay(data: AssistantData, day: DayKey): (Task | null)[] {
  const slots: (Task | null)[] = [null, null, null];
  for (const task of data.tasks) {
    if (task.scheduledFor !== day) continue;
    const rank = task.big3Rank;
    if (rank === 1 || rank === 2 || rank === 3) {
      if (slots[rank - 1] === null) slots[rank - 1] = task;
    }
  }
  return slots;
}

/** A day is "done" when its tasks are finished AND its habits are logged. */
export function dayProgress(
  data: AssistantData,
  day: DayKey,
): { done: number; total: number; ratio: number } {
  const tasks = data.tasks.filter((t) => t.scheduledFor === day);
  const habits = habitsDueOn(data, day);

  const doneTasks = tasks.filter(isComplete).length;
  const doneHabits = habits.filter((h) => isHabitDone(data.habitLogs, h.id, day)).length;

  const done = doneTasks + doneHabits;
  const total = tasks.length + habits.length;
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

/* -------------------------------------------------------------------------
 * Habits
 * ---------------------------------------------------------------------- */

/** True while `day` sits inside the habit's own lifetime. */
function withinLifetime(habit: Habit, day: DayKey): boolean {
  const created = timestampDay(habit.createdAt);
  if (created && day < created) return false;
  const archived = timestampDay(habit.archivedAt);
  if (archived && day > archived) return false;
  return true;
}

/** Cadence check for the fixed-schedule types. `timesPerWeek` needs the logs. */
function matchesFixedCadence(habit: Habit, day: DayKey): boolean {
  const cadence = habit.cadence;
  if (cadence && cadence.type === 'weekdays') {
    const days = Array.isArray(cadence.days) ? cadence.days : [];
    return days.includes(isoWeekday(day));
  }
  return true;
}

export function isHabitDone(logs: HabitLog[], habitId: ID, day: DayKey): boolean {
  return logs.some((log) => log.habitId === habitId && log.date === day);
}

/**
 * Is this habit asking to be done on this day?
 *
 * `daily` always, `weekdays` on its own days, and `timesPerWeek` until that
 * Mon–Sun week's target has been met — a day that has already been logged
 * always reads as due so it can be shown ticked rather than vanishing.
 */
export function isHabitDue(habit: Habit, day: DayKey, logs: HabitLog[]): boolean {
  if (!habit) return false;
  if (!withinLifetime(habit, day)) return false;

  const cadence = habit.cadence;
  if (cadence && cadence.type === 'timesPerWeek') {
    if (isHabitDone(logs, habit.id, day)) return true;
    const target = Math.max(1, Math.trunc(cadence.target) || 1);
    const week = weekDaysFrom(weekStartKey(day));
    let logged = 0;
    for (const d of week) if (isHabitDone(logs, habit.id, d)) logged += 1;
    return logged < target;
  }

  return matchesFixedCadence(habit, day);
}

/** Live habits asking for attention on `day`, in the owner's order. */
export function habitsDueOn(data: AssistantData, day: DayKey): Habit[] {
  return data.habits
    .filter((h) => !h.archivedAt && isHabitDue(h, day, data.habitLogs))
    .sort(byOrder);
}

export function habitLogDays(data: AssistantData, habitId: ID): Set<DayKey> {
  const days = new Set<DayKey>();
  for (const log of data.habitLogs) if (log.habitId === habitId) days.add(log.date);
  return days;
}

/** The earliest day worth scanning for a habit: its birth or its first log. */
function scanStart(habit: Habit, done: Set<DayKey>, refDay: DayKey): DayKey {
  const floor = addDaysKey(refDay, -MAX_SCAN_DAYS);
  let earliest: DayKey | null = timestampDay(habit.createdAt);
  for (const day of done) {
    if (earliest === null || day < earliest) earliest = day;
  }
  if (earliest === null || earliest < floor) return floor;
  return earliest;
}

function weekLogCount(done: Set<DayKey>, mondayKey: DayKey): number {
  let count = 0;
  for (const day of weekDaysFrom(mondayKey)) if (done.has(day)) count += 1;
  return count;
}

/**
 * Current and best runs.
 *
 * The grace rule matters: a habit that is due TODAY but not yet ticked has not
 * broken anything — only a miss strictly before the reference day ends a run.
 */
function computeRuns(
  habit: Habit,
  done: Set<DayKey>,
  refDay: DayKey,
): { current: number; best: number } {
  const cadence = habit.cadence;

  /* ---- times-per-week: the unit of the streak is a whole week ---- */
  if (cadence && cadence.type === 'timesPerWeek') {
    const target = Math.max(1, Math.trunc(cadence.target) || 1);
    const thisWeek = weekStartKey(refDay);

    let current = 0;
    let cursor = weekLogCount(done, thisWeek) >= target ? thisWeek : addDaysKey(thisWeek, -7);
    const startWeek = weekStartKey(scanStart(habit, done, refDay));
    while (cursor >= startWeek && weekLogCount(done, cursor) >= target) {
      current += 1;
      cursor = addDaysKey(cursor, -7);
    }

    let best = 0;
    let run = 0;
    let week = startWeek;
    let guard = 0;
    while (week <= thisWeek && guard < MAX_SCAN_DAYS / 7 + 2) {
      const met = weekLogCount(done, week) >= target;
      if (met) {
        run += 1;
        if (run > best) best = run;
      } else if (week !== thisWeek) {
        run = 0;
      }
      week = addDaysKey(week, 7);
      guard += 1;
    }

    return { current, best: Math.max(best, current) };
  }

  /* ---- daily / weekdays: the unit is a due day ---- */
  const start = scanStart(habit, done, refDay);

  let current = 0;
  let cursor = refDay;
  // Skip an untouched today so it cannot end a run that is still alive.
  if (withinLifetime(habit, refDay) && matchesFixedCadence(habit, refDay) && !done.has(refDay)) {
    cursor = addDaysKey(refDay, -1);
  }
  let guard = 0;
  while (cursor >= start && guard < MAX_SCAN_DAYS) {
    guard += 1;
    if (!withinLifetime(habit, cursor) || !matchesFixedCadence(habit, cursor)) {
      cursor = addDaysKey(cursor, -1);
      continue;
    }
    if (!done.has(cursor)) break;
    current += 1;
    cursor = addDaysKey(cursor, -1);
  }

  let best = 0;
  let run = 0;
  let day = start;
  guard = 0;
  while (day <= refDay && guard < MAX_SCAN_DAYS) {
    guard += 1;
    if (withinLifetime(habit, day) && matchesFixedCadence(habit, day)) {
      if (done.has(day)) {
        run += 1;
        if (run > best) best = run;
      } else if (day !== refDay) {
        run = 0;
      }
    }
    day = addDaysKey(day, 1);
  }

  return { current, best: Math.max(best, current) };
}

export function habitStreak(data: AssistantData, habitId: ID, refDay: DayKey): HabitStreak {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return { current: 0, best: 0, dueToday: false, doneToday: false, total: 0 };

  const done = habitLogDays(data, habitId);
  const doneToday = done.has(refDay);
  const dueToday = isHabitDue(habit, refDay, data.habitLogs) && !doneToday;
  const { current, best } = computeRuns(habit, done, refDay);

  return { current, best, dueToday, doneToday, total: done.size };
}

/* -------------------------------------------------------------------------
 * Series + rollups for the Insights surface
 * ---------------------------------------------------------------------- */

/** Per-day task completion across a window, oldest first. */
export function completionSeries(
  data: AssistantData,
  days: number,
  endDay: DayKey,
): { date: DayKey; label: string; completed: number; scheduled: number; ratio: number }[] {
  const window = lastNDays(days, endDay);
  const labelFormat = window.length <= 7 ? 'EEE' : 'd MMM';

  return window.map((date) => {
    const scheduledTasks = data.tasks.filter((t) => t.scheduledFor === date);
    const completed = scheduledTasks.filter(isComplete).length;
    const scheduled = scheduledTasks.length;
    return {
      date,
      label: formatKey(date, labelFormat),
      completed,
      scheduled,
      ratio: scheduled === 0 ? 0 : completed / scheduled,
    };
  });
}

/**
 * Where the finished work went. Every area is returned (so a chart's colours
 * and legend stay stable) plus an "Unassigned" bucket when there is one.
 */
export function tasksByArea(
  data: AssistantData,
  days: number,
  endDay: DayKey,
): { areaId: ID | null; name: string; color: string; completed: number }[] {
  const window = new Set(lastNDays(days, endDay));
  const counts = new Map<string, number>();
  let unassigned = 0;

  for (const task of data.tasks) {
    const completedDay = timestampDay(task.completedAt);
    if (!completedDay || !window.has(completedDay)) continue;
    const { area } = goalTrace(data, task);
    if (area) counts.set(area.id, (counts.get(area.id) ?? 0) + 1);
    else unassigned += 1;
  }

  const rows = [...data.areas].sort(byOrder).map((area) => ({
    areaId: area.id as ID | null,
    name: area.name,
    color: area.color || UNASSIGNED_COLOR,
    completed: counts.get(area.id) ?? 0,
  }));

  if (unassigned > 0) {
    rows.push({ areaId: null, name: 'Unassigned', color: UNASSIGNED_COLOR, completed: unassigned });
  }

  return rows.sort((a, b) => b.completed - a.completed);
}

/** How reliably each live habit met its cadence across the window. */
export function habitConsistency(
  data: AssistantData,
  days: number,
  endDay: DayKey,
): { habitId: ID; name: string; ratio: number; current: number; best: number }[] {
  const window = lastNDays(days, endDay);

  return data.habits
    .filter((h) => !h.archivedAt)
    .sort(byOrder)
    .map((habit) => {
      let due = 0;
      let done = 0;
      for (const day of window) {
        const logged = isHabitDone(data.habitLogs, habit.id, day);
        if (logged) {
          due += 1;
          done += 1;
        } else if (isHabitDue(habit, day, data.habitLogs)) {
          due += 1;
        }
      }
      const streak = habitStreak(data, habit.id, endDay);
      return {
        habitId: habit.id,
        name: habit.name,
        ratio: due === 0 ? 0 : done / due,
        current: streak.current,
        best: streak.best,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/**
 * Momentum — one honest 0–100 number for "how is it actually going".
 *
 * Weighting over the last 7 days:
 *   50 %  task follow-through   completed ÷ scheduled
 *   30 %  habit follow-through  logged ÷ due
 *   20 %  review consistency    days with a daily review ÷ 7
 *
 * A component with no denominator (a week with nothing scheduled, or no habits
 * yet) is dropped and its weight redistributed across the rest, so an empty
 * corner of the system never drags the score down for work not attempted.
 */
export function momentumScore(data: AssistantData, refDay: DayKey): number {
  const window = lastNDays(7, refDay);

  let scheduled = 0;
  let completed = 0;
  for (const task of data.tasks) {
    if (task.scheduledFor && window.includes(task.scheduledFor)) {
      scheduled += 1;
      if (isComplete(task)) completed += 1;
    }
  }

  let habitDue = 0;
  let habitDone = 0;
  for (const habit of data.habits) {
    if (habit.archivedAt) continue;
    for (const day of window) {
      const logged = isHabitDone(data.habitLogs, habit.id, day);
      if (logged) {
        habitDue += 1;
        habitDone += 1;
      } else if (isHabitDue(habit, day, data.habitLogs)) {
        habitDue += 1;
      }
    }
  }

  const reviewDays = new Set(
    data.reviews.filter((r) => r.type === 'daily').map((r) => r.date),
  );
  const reviewed = window.filter((day) => reviewDays.has(day)).length;

  const parts: { weight: number; value: number }[] = [];
  if (scheduled > 0) parts.push({ weight: 0.5, value: completed / scheduled });
  if (habitDue > 0) parts.push({ weight: 0.3, value: habitDone / habitDue });
  parts.push({ weight: 0.2, value: reviewed / window.length });

  const weight = parts.reduce((sum, p) => sum + p.weight, 0);
  if (weight === 0) return 0;

  const score = parts.reduce((sum, p) => sum + p.weight * clamp01(p.value), 0) / weight;
  return Math.round(clamp01(score) * 100);
}

/** Consecutive days ending at `refDay` that carry a daily review. */
export function reviewStreak(data: AssistantData, refDay: DayKey): number {
  const reviewed = new Set(data.reviews.filter((r) => r.type === 'daily').map((r) => r.date));

  // Today's shutdown may still be ahead of you — it doesn't break yesterday's run.
  let cursor = reviewed.has(refDay) ? refDay : addDaysKey(refDay, -1);
  let streak = 0;
  let guard = 0;
  while (reviewed.has(cursor) && guard < MAX_SCAN_DAYS) {
    streak += 1;
    cursor = addDaysKey(cursor, -1);
    guard += 1;
  }
  return streak;
}

/** The header numbers, in one pass-friendly bundle. */
export function statsSummary(
  data: AssistantData,
  refDay: DayKey,
): {
  activeGoals: number;
  achievedGoals: number;
  tasksDone7: number;
  tasksDone30: number;
  habitRate7: number;
  longestStreak: number;
  inboxCount: number;
  overdueCount: number;
} {
  const window7 = new Set(lastNDays(7, refDay));
  const window30 = new Set(lastNDays(30, refDay));

  let tasksDone7 = 0;
  let tasksDone30 = 0;
  for (const task of data.tasks) {
    const day = timestampDay(task.completedAt);
    if (!day) continue;
    if (window7.has(day)) tasksDone7 += 1;
    if (window30.has(day)) tasksDone30 += 1;
  }

  let habitDue = 0;
  let habitDone = 0;
  let longestStreak = 0;
  for (const habit of data.habits) {
    if (habit.archivedAt) continue;
    for (const day of window7) {
      const logged = isHabitDone(data.habitLogs, habit.id, day);
      if (logged) {
        habitDue += 1;
        habitDone += 1;
      } else if (isHabitDue(habit, day, data.habitLogs)) {
        habitDue += 1;
      }
    }
    const best = habitStreak(data, habit.id, refDay).best;
    if (best > longestStreak) longestStreak = best;
  }

  return {
    activeGoals: data.goals.filter((g) => g.status === 'active').length,
    achievedGoals: data.goals.filter((g) => g.status === 'achieved').length,
    tasksDone7,
    tasksDone30,
    habitRate7: habitDue === 0 ? 0 : habitDone / habitDue,
    longestStreak,
    inboxCount: data.inbox.length,
    overdueCount: overdueTasks(data, refDay).length,
  };
}

/** Convenience for callers that just want "now" without importing dates.ts. */
export function todayProgress(data: AssistantData): { done: number; total: number; ratio: number } {
  return dayProgress(data, todayKey());
}

/* -------------------------------------------------------------------------
 * Training
 *
 * Volume — sets × reps × load, summed — is the one number that makes a week of
 * lifting comparable to the week before it. It is deliberately unitless here:
 * every load in a document is counted in `settings.loadUnit`, so the figure is
 * only ever compared against other figures from the same document.
 *
 * Bodyweight work carries a load of 0 and therefore no volume, which is honest
 * rather than clever: the set still counts under `sets`, it just cannot be
 * weighed. That is why sessions and sets are reported alongside volume and not
 * folded into it.
 * ---------------------------------------------------------------------- */

/** Everything logged on `day`, in the order it was arranged. */
export function exercisesForDay(data: AssistantData, day: DayKey): Exercise[] {
  return data.exercises.filter((e) => e.date === day).sort(byOrder);
}

/** One exercise's contribution to volume. */
export function exerciseVolume(exercise: Exercise): number {
  const volume = exercise.sets * exercise.reps * exercise.load;
  return Number.isFinite(volume) ? volume : 0;
}

export interface TrainingTotals {
  /** Days with at least one exercise on them. */
  sessions: number;
  exercises: number;
  sets: number;
  /** Σ sets × reps × load. */
  volume: number;
  /** How many of the exercises are ticked off. */
  done: number;
}

function totalsFrom(exercises: Exercise[]): TrainingTotals {
  const days = new Set<DayKey>();
  let sets = 0;
  let volume = 0;
  let done = 0;

  for (const exercise of exercises) {
    days.add(exercise.date);
    sets += exercise.sets;
    volume += exerciseVolume(exercise);
    if (exercise.completedAt !== null) done += 1;
  }

  return { sessions: days.size, exercises: exercises.length, sets, volume, done };
}

/** The totals for one day. `sessions` is 0 or 1 by construction. */
export function dayTraining(data: AssistantData, day: DayKey): TrainingTotals {
  return totalsFrom(exercisesForDay(data, day));
}

/** The totals for the Mon–Sun week starting at `mondayKey`. */
export function weekTraining(data: AssistantData, mondayKey: DayKey): TrainingTotals {
  const days = new Set(weekDaysFrom(mondayKey));
  return totalsFrom(data.exercises.filter((e) => days.has(e.date)));
}


/* -------------------------------------------------------------------------
 * Food
 * ---------------------------------------------------------------------- */

/** Everything eaten on `day`, in the order it was logged. */
export function foodForDay(data: AssistantData, day: DayKey): FoodEntry[] {
  return data.food.filter((f) => f.date === day).sort(byOrder);
}

/** Total kcal logged on `day`. */
export function caloriesForDay(data: AssistantData, day: DayKey): number {
  let total = 0;
  for (const entry of data.food) {
    if (entry.date === day) total += entry.calories;
  }
  return total;
}

export interface CalorieDay {
  eaten: number;
  target: number;
  /** `target - eaten`. NEGATIVE once the day has gone over, which is the point. */
  left: number;
  /** 0–1, clamped for the meter. */
  ratio: number;
  over: boolean;
  entries: number;
}

export function calorieDay(data: AssistantData, day: DayKey): CalorieDay {
  const target = data.settings.calorieTarget;
  const eaten = caloriesForDay(data, day);
  const entries = data.food.reduce((n, f) => (f.date === day ? n + 1 : n), 0);
  return {
    eaten,
    target,
    left: target - eaten,
    ratio: target > 0 ? clamp01(eaten / target) : 0,
    over: eaten > target,
    entries,
  };
}

export interface CalorieWeek {
  /** Mean kcal across the LOGGED days only — see below. */
  average: number;
  /** How many of the seven days have at least one entry. */
  loggedDays: number;
  total: number;
  /** Each day of the week in order, with its total. Drives the day strip. */
  days: { day: DayKey; total: number; entries: number }[];
}

/**
 * The week's intake, keyed off its Monday.
 *
 * The average divides by the days that were actually LOGGED, not by seven. On
 * a Tuesday the alternative reports someone eating 2,000 a day as averaging
 * 570 — a number that is arithmetically true and useless, and which quietly
 * reads as "you are miles under" for five days out of every seven. The count
 * is returned alongside it so the UI can say what the divisor was.
 */
export function calorieWeek(data: AssistantData, mondayKey: DayKey): CalorieWeek {
  const days = weekDaysFrom(mondayKey).map((day) => {
    let total = 0;
    let entries = 0;
    for (const food of data.food) {
      if (food.date !== day) continue;
      total += food.calories;
      entries += 1;
    }
    return { day, total, entries };
  });

  const logged = days.filter((d) => d.entries > 0);
  const total = logged.reduce((sum, d) => sum + d.total, 0);

  return {
    average: logged.length === 0 ? 0 : Math.round(total / logged.length),
    loggedDays: logged.length,
    total,
    days,
  };
}

/* -------------------------------------------------------------------------
 * Meals
 * ---------------------------------------------------------------------- */

/** A meal costs what its ingredients cost. There is no separate total. */
export function mealCalories(meal: Meal): number {
  return meal.items.reduce((total, item) => total + item.calories, 0);
}

export function mealItems(meal: Meal): FoodItem[] {
  return [...meal.items].sort((a, b) => a.order - b.order);
}

/** The library, in the owner's own arrangement. */
export function allMeals(data: AssistantData): Meal[] {
  return [...data.meals].sort((a, b) => a.order - b.order);
}

/**
 * How many times a meal has been logged.
 *
 * Counted from the entries rather than kept as a field on the meal: a stored
 * counter has to be decremented when a day is deleted and when an undo walks
 * one back, and the first time either is missed the number is wrong forever.
 */
export function mealUseCount(data: AssistantData, mealId: ID): number {
  return data.food.reduce((n, entry) => (entry.mealId === mealId ? n + 1 : n), 0);
}

/* -------------------------------------------------------------------------
 * Macros
 *
 * Everything below is derived at read and stored nowhere. Only ingredients
 * that carry BOTH a weight and a set of per-100 g facts contribute — a coffee
 * logged as "180" has calories and no macros, and there is no honest way to
 * guess what its protein was.
 *
 * That is why every one of these returns the kcal it COVERED alongside the
 * grams. "42 P · 18 F · 60 C" under a 2,100 kcal day is a claim about the whole
 * day; "…from 900 of 2,100 kcal weighed" is the truth. The UI is expected to
 * say the second one, and it cannot unless the number comes back with it.
 *
 * No attempt is made to reconcile 4P + 9F + 4C against the calorie figure. They
 * disagree by a few per cent on real packet data — rounding, fibre, alcohol,
 * the Atwater factors themselves — and a UI that draws them as parts of one bar
 * would be asserting an identity that does not hold.
 * ---------------------------------------------------------------------- */

/**
 * The calories a weighed ingredient works out to.
 *
 * THE one definition, and it lives here rather than in any of its callers
 * because there are three of them in three different layers: the store when an
 * edit lands, the repo when a document loads, and the seed when the demo data
 * is built. They have to agree to the calorie — the seed writes its numbers
 * straight into storage and the repo reads them back on the very next reload.
 *
 * They did not agree when this was first written: the seed truncated while the
 * other two rounded, so 150 g of a 59 kcal/100 g yoghurt was 88 kcal until you
 * refreshed the page, at which point it silently became 89 and took the meal
 * total with it.
 *
 * Rounds, because it is a measurement and not a count.
 */
export function caloriesFrom(grams: number, kcalPer100: number): number {
  return Math.round((kcalPer100 * grams) / 100);
}

/**
 * True when this ingredient has both halves of the sum.
 *
 * The single definition. `settleItem` in the store, `coerceItems` in the repo
 * and the editor's read-only kcal all test the same three things, because the
 * moment they disagree a row shows a figure it did not compute.
 *
 * `kcal > 0` and not merely "the facts object exists": the facts are typed one
 * box at a time, and an ingredient that has been told its protein but not yet
 * its calories is not weighed — it is halfway through being told.
 */
export function isWeighed(item: FoodItem): boolean {
  return item.grams !== undefined && item.per100 !== undefined && item.per100.kcal > 0;
}

/** What one ingredient actually contributes, or null if it was never weighed. */
export function itemMacros(item: FoodItem): Macros | null {
  if (!isWeighed(item) || item.grams === undefined || item.per100 === undefined) return null;
  const share = item.grams / 100;
  return {
    protein: round1(item.per100.protein * share),
    fat: round1(item.per100.fat * share),
    carbs: round1(item.per100.carbs * share),
  };
}

export interface MacroTotals {
  macros: Macros;
  /** kcal belonging to the weighed ingredients — what the macros describe. */
  coveredKcal: number;
  /** kcal in scope altogether. Equal to `coveredKcal` when everything is weighed. */
  totalKcal: number;
  /** How many of the ingredients in scope carried facts. */
  weighed: number;
}

/** Sums the weighed ingredients in a list. Null when none of them are. */
export function itemsMacros(items: FoodItem[]): MacroTotals | null {
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  let coveredKcal = 0;
  let totalKcal = 0;
  let weighed = 0;

  for (const item of items) {
    totalKcal += item.calories;
    const macros = itemMacros(item);
    if (!macros) continue;
    protein += macros.protein;
    fat += macros.fat;
    carbs += macros.carbs;
    coveredKcal += item.calories;
    weighed += 1;
  }

  if (weighed === 0) return null;
  return {
    macros: { protein: round1(protein), fat: round1(fat), carbs: round1(carbs) },
    coveredKcal,
    totalKcal,
    weighed,
  };
}

/** A meal's macros, from the ingredients that were weighed. */
export function mealMacros(meal: Meal): MacroTotals | null {
  return itemsMacros(meal.items);
}

/**
 * A day's macros across every entry on it.
 *
 * `totalKcal` counts the whole day including one-off lines with no breakdown at
 * all, which is deliberate: those calories are real, they are simply not
 * described, and hiding them from the divisor would make the coverage look
 * better than it is.
 */
export function dayMacros(data: AssistantData, day: DayKey): MacroTotals | null {
  const items: FoodItem[] = [];
  let unaccounted = 0;

  for (const entry of data.food) {
    if (entry.date !== day) continue;
    if (entry.items.length > 0) items.push(...entry.items);
    else unaccounted += entry.calories;
  }

  const totals = itemsMacros(items);
  if (!totals) return null;
  return { ...totals, totalKcal: totals.totalKcal + unaccounted };
}

/** The days from `fromDay` forward that already have something planned. */
export function plannedDaysFrom(data: AssistantData, fromDay: DayKey, count: number): DayKey[] {
  const days: DayKey[] = [];
  for (let i = 0; i < count; i += 1) days.push(addDaysKey(fromDay, i));
  return days.filter((day) => data.food.some((f) => f.date === day));
}

/* -------------------------------------------------------------------------
 * The workout plan
 * ---------------------------------------------------------------------- */

/** The library, in the owner's own arrangement. */
export function allPlans(data: AssistantData): WorkoutPlan[] {
  return [...data.workoutPlans].sort((a, b) => a.order - b.order);
}

export function planExercises(plan: WorkoutPlan): PlanExercise[] {
  return [...plan.items].sort((a, b) => a.order - b.order);
}

/** Sets and prescribed volume, so a plan card can say how big a day it is. */
export function planTotals(plan: WorkoutPlan): { sets: number; volume: number } {
  let sets = 0;
  let volume = 0;
  for (const item of plan.items) {
    sets += item.sets;
    volume += item.sets * item.reps * item.load;
  }
  return { sets, volume: Number.isFinite(volume) ? volume : 0 };
}

/** How many days have been laid out from this plan. Counted, never stored. */
export function planUseCount(data: AssistantData, planId: ID): number {
  let n = 0;
  for (const day of Object.values(data.workoutDays)) {
    if (day.planId === planId) n += 1;
  }
  return n;
}

/**
 * The most recent day BEFORE `day` that ran this plan.
 *
 * This is what makes applying a plan useful rather than merely convenient: the
 * loads that land on the new day are the ones you finished the last one with.
 * A template frozen at the numbers it was written with would hand you the same
 * weight every week forever.
 */
export function lastDayUsingPlan(
  data: AssistantData,
  planId: ID,
  before: DayKey,
): DayKey | null {
  let best: DayKey | null = null;
  for (const [key, value] of Object.entries(data.workoutDays)) {
    if (value.planId !== planId || key >= before) continue;
    if (best === null || key > best) best = key;
  }
  return best;
}
