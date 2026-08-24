/* ---------------------------------------------------------------------------
 * brief.ts — the whole document, written out for something else to read.
 *
 * WHY THIS IS NOT THE JSON EXPORT
 * -------------------------------
 * `repo.exportJson()` already hands over every byte, and it is the right thing
 * to keep a backup in or to import back. It is close to useless as something to
 * hand a language model and ask a question about.
 *
 * A row in that file is `{"id":"a3f…","goalId":"7c1…","milestoneId":null,
 * "big3Rank":2,"carryCount":3,"order":4}`. To say anything about it a reader
 * has to resolve two uuids, know that `big3Rank` means a priority and not a
 * count, know that `order` is a sort position and means nothing on its own, and
 * hold the whole cascade in mind at once. Half of what the app knows is not in
 * the file at all — progress, streaks, weekly volume, calories left, macro
 * coverage are all DERIVED at render and stored nowhere, so a reader of the
 * JSON either recomputes them from scratch or answers without them.
 *
 * So this resolves every link to a name, spells every date out, states the
 * conventions the numbers are written in, and includes the derived figures
 * beside the rows they came from. It covers every field in the document that
 * carries meaning — ids and sort positions are the only things left out, and
 * neither is a fact about anybody's life.
 *
 * It is Markdown because that is what these things read best, and because it
 * stays legible to the person pasting it — which matters, since they are about
 * to hand it to somebody else's computer.
 *
 * PURE
 * ----
 * No clock, no DOM, no storage. `today` and `generatedAt` come in as arguments
 * so the same document always produces the same text, which is the only reason
 * it can be tested at all.
 * ------------------------------------------------------------------------- */

import { formatKey, weekStartKey } from './dates';
import {
  areaProgress,
  calorieDay,
  dayMacros,
  exerciseVolume,
  goalMilestones,
  goalProgress,
  goalTasks,
  habitStreak,
  isWeighed,
  mealCalories,
  mealItems,
  mealMacros,
  mealUseCount,
  momentumScore,
  planTotals,
  planUseCount,
  reviewStreak,
  statsSummary,
  weekTraining,
  type MacroTotals,
} from './derive';
import type {
  AssistantData,
  DayKey,
  FoodItem,
  HabitCadence,
  ID,
  LifeArea,
  Task,
} from './types';

/* -------------------------------------------------------------------------
 * Small formatters
 *
 * Numbers go out bare — no thousands separators. The brief is read by a
 * machine first and "1,282" is one more thing for it to undo.
 * ---------------------------------------------------------------------- */

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function round1(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** `2026-08-05 (Wed)` — sortable, unambiguous, and readable without counting. */
function day(key: DayKey): string {
  return `${key} (${formatKey(key, 'EEE')})`;
}

/** A full day heading, with the weekday and month spelled out. */
function dayLong(key: DayKey): string {
  return `${key} — ${formatKey(key, 'EEEE d MMMM yyyy')}`;
}

/**
 * Marks a day that has not happened yet.
 *
 * The single most misreadable thing in this export. Training and food are both
 * planned in the same place they are recorded — putting Thursday's meals on
 * Thursday is the prep list, and it is the same gesture as logging Monday's —
 * so a future day looks in every respect like a past one. Without this, a
 * reader adds next Saturday's planned 1,225 kcal into an average of what
 * somebody actually ate, and every conclusion after that is off.
 */
function tense(key: DayKey, today: DayKey): string {
  return key > today ? ' — PLANNED, has not happened yet' : '';
}

/** The calendar day an ISO timestamp fell on, locally. */
function stampDay(stamp: string | null): DayKey | null {
  if (!stamp) return null;
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Squashes newlines so a multi-line note cannot break out of its bullet. */
function oneLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, ' / ').trim();
}

const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function cadenceLabel(cadence: HabitCadence): string {
  if (cadence.type === 'daily') return 'every day';
  if (cadence.type === 'weekdays') {
    const days = [...cadence.days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d] ?? d);
    return days.length > 0 ? `on ${days.join(', ')}` : 'on no days';
  }
  return `${cadence.target}× a week`;
}

function macroLabel(totals: MacroTotals): string {
  const base = `${round1(totals.macros.protein)} g protein, ${round1(totals.macros.fat)} g fat, ${round1(totals.macros.carbs)} g carbs`;
  if (totals.coveredKcal >= totals.totalKcal) return base;
  return `${base} (from ${totals.coveredKcal} of ${totals.totalKcal} kcal — the rest was not weighed)`;
}

/* -------------------------------------------------------------------------
 * The builder
 * ---------------------------------------------------------------------- */

export interface BriefMeta {
  /** How many characters the brief came to — shown to whoever asked for it. */
  characters: number;
  /** A rough token count. Four characters per token is the usual back-of-envelope. */
  approxTokens: number;
}

export interface BriefResult {
  markdown: string;
  meta: BriefMeta;
}

export function buildBrief(
  data: AssistantData,
  today: DayKey,
  generatedAt: Date = new Date(),
): BriefResult {
  const out: string[] = [];
  const push = (...lines: string[]): void => {
    out.push(...lines);
  };
  const blank = (): void => {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
  };

  /* ---- lookups, built once ---- */
  const areaById = new Map<ID, LifeArea>(data.areas.map((a) => [a.id, a]));
  const goalById = new Map(data.goals.map((g) => [g.id, g]));
  const milestoneById = new Map(data.milestones.map((m) => [m.id, m]));
  const planById = new Map(data.workoutPlans.map((p) => [p.id, p]));
  const mealById = new Map(data.meals.map((m) => [m.id, m]));

  /** Area / Goal / Milestone, as far up the cascade as a task actually reaches. */
  const trace = (task: Task): string => {
    const milestone = task.milestoneId ? milestoneById.get(task.milestoneId) ?? null : null;
    const goal = task.goalId
      ? goalById.get(task.goalId) ?? null
      : milestone
        ? goalById.get(milestone.goalId) ?? null
        : null;
    const area = goal?.areaId ? areaById.get(goal.areaId) ?? null : null;
    const parts = [area?.name, goal?.title, milestone?.title].filter(Boolean);
    return parts.length > 0 ? parts.join(' → ') : 'unfiled';
  };

  const taskLine = (task: Task): string => {
    const marks: string[] = [trace(task)];
    if (task.big3Rank) marks.push(`Big 3 #${task.big3Rank}`);
    if (task.carryCount > 0) marks.push(`carried forward ${task.carryCount}×`);
    const done = stampDay(task.completedAt);
    if (done) marks.push(`done ${done}`);
    if (task.notes.trim().length > 0) marks.push(`note: ${oneLine(task.notes)}`);
    return `- [${task.completedAt ? 'x' : ' '}] ${task.title} — ${marks.join(' · ')}`;
  };

  /* =====================================================================
   * Header
   * ================================================================== */

  const name = data.settings.userName.trim();
  push(`# ${name ? `${name}'s` : 'Personal'} assistant — complete export`);
  blank();
  push(
    `Generated ${generatedAt.toISOString()} · "today" is ${dayLong(today)} · ` +
      `loads in ${data.settings.loadUnit} · calorie target ${data.settings.calorieTarget}/day.`,
  );

  /* ---- what the reader needs to know before reading ---- */
  blank();
  push('## How to read this');
  blank();
  push(
    '- Dates are LOCAL calendar days written `yyyy-mm-dd`, with the weekday in brackets. Weeks run Monday to Sunday.',
    '- Figures described as derived are computed from the rows beneath them and are stored nowhere; they cannot disagree with those rows.',
    '- A goal rolls up from its milestones if it has any, otherwise from its linked tasks, otherwise from the goals laddering up to it. The basis is stated each time, because 60% of two milestones and 60% of forty tasks are not the same claim.',
    '- A task with no day is in the backlog, not overdue. "carried forward N×" counts the mornings it was rolled onto a new day without being done — a high count usually means the task is too big or not really wanted.',
    '- Habit streaks respect the cadence: a Mon/Wed/Fri habit is not broken by a Tuesday.',
    `- Training: load is the working weight in ${data.settings.loadUnit}, and volume is sets × reps × load. Bodyweight work carries a load of 0, so it contributes sets but no volume.`,
    '- Food: an ingredient written `200 g @ 165 kcal/100 g` was weighed, and its calories are that multiplication rather than a typed figure. One written as a bare number was not weighed.',
    '- Macros exist only for weighed ingredients. Every macro total says how many of the calories in its scope it can actually account for; the remainder is food that was logged without a breakdown. Nothing here reconciles 4/9/4 against the calorie figure, because on real packet data it does not.',
    '- Days AFTER today are marked PLANNED. Training and food are written in the same place whether they are being planned or recorded — putting Thursday\'s meals on Thursday IS the prep list — so a future day looks exactly like a past one. Do not count a planned day as something that happened.',
    '- An empty section means there is no data of that kind, not that it was left out. This export is complete apart from internal ids and sort positions.',
  );

  /* =====================================================================
   * 1. Snapshot
   * ================================================================== */

  const stats = statsSummary(data, today);
  const momentum = momentumScore(data, today);

  blank();
  push('## 1. Snapshot', '');
  push(
    `- Momentum over the last 7 days: ${momentum}/100 (derived — task follow-through 50%, habit follow-through 30%, review consistency 20%, with any component that had nothing due dropped and its weight shared out)`,
    `- Goals: ${stats.activeGoals} active, ${stats.achievedGoals} achieved`,
    `- Tasks completed: ${stats.tasksDone7} in the last 7 days, ${stats.tasksDone30} in the last 30`,
    `- Habit follow-through over the last 7 days: ${pct(stats.habitRate7)} of what was due`,
    `- Longest habit streak ever run: ${stats.longestStreak} days`,
    `- Daily-review streak ending today: ${reviewStreak(data, today)} days`,
    `- Overdue tasks: ${stats.overdueCount} · unfiled inbox notes: ${stats.inboxCount}`,
  );

  const counts = [
    `${data.areas.length} life areas`,
    `${data.goals.length} goals`,
    `${data.milestones.length} milestones`,
    `${data.tasks.length} tasks`,
    `${data.habits.length} habits`,
    `${data.habitLogs.length} habit logs`,
    `${data.exercises.length} logged exercises`,
    `${data.workoutPlans.length} workout plans`,
    `${data.food.length} food entries`,
    `${data.meals.length} saved meals`,
    `${data.reviews.length} reviews`,
  ];
  push(`- The document holds ${counts.join(', ')}.`);

  /* =====================================================================
   * 2. Life areas
   * ================================================================== */

  blank();
  push('## 2. Life areas', '');
  if (data.areas.length === 0) {
    push('_None._');
  } else {
    for (const area of [...data.areas].sort((a, b) => a.order - b.order)) {
      const progress = areaProgress(data, area.id);
      push(
        `- **${area.name}** — ${progress.goals} live ${progress.goals === 1 ? 'goal' : 'goals'}, ` +
          `${pct(progress.ratio)} (derived: the mean of the goals under it that can be measured at all)`,
      );
    }
  }

  /* =====================================================================
   * 3. Goals and milestones
   * ================================================================== */

  blank();
  push('## 3. Goals', '');
  if (data.goals.length === 0) {
    push('_None._');
  } else {
    const ordered = [...data.goals].sort((a, b) => {
      const rank = { quarter: 0, year: 1, vision: 2 } as const;
      if (rank[a.horizon] !== rank[b.horizon]) return rank[a.horizon] - rank[b.horizon];
      return a.order - b.order;
    });

    for (const goal of ordered) {
      const area = goal.areaId ? areaById.get(goal.areaId) : null;
      const parent = goal.parentGoalId ? goalById.get(goal.parentGoalId) : null;
      const progress = goalProgress(data, goal.id);
      const milestones = goalMilestones(data, goal.id);
      const tasks = goalTasks(data, goal.id);
      const tasksDone = tasks.filter((t) => t.completedAt).length;

      blank();
      push(`### ${goal.title}`, '');
      const facts = [
        `horizon: ${goal.horizon}`,
        `area: ${area?.name ?? 'unfiled'}`,
        `status: ${goal.status}`,
      ];
      if (goal.targetDate) facts.push(`target date: ${day(goal.targetDate)}`);
      if (parent) facts.push(`ladders up to: ${parent.title}`);
      const achieved = stampDay(goal.achievedAt);
      if (achieved) facts.push(`achieved: ${achieved}`);
      facts.push(`created: ${stampDay(goal.createdAt) ?? goal.createdAt}`);
      push(`- ${facts.join(' · ')}`);
      if (goal.why.trim().length > 0) push(`- Why: ${oneLine(goal.why)}`);
      push(
        `- Progress: ${pct(progress.ratio)} — ${progress.done}/${progress.total} ` +
          `(derived from its ${progress.basis === 'none' ? 'nothing yet' : progress.basis})`,
      );
      push(`- Linked tasks: ${tasks.length}, of which ${tasksDone} done`);

      if (milestones.length > 0) {
        push('', 'Milestones:');
        for (const milestone of milestones) {
          const bits: string[] = [];
          if (milestone.targetDate) bits.push(`by ${day(milestone.targetDate)}`);
          const doneOn = stampDay(milestone.completedAt);
          if (doneOn) bits.push(`done ${doneOn}`);
          push(
            `- [${milestone.completedAt ? 'x' : ' '}] ${milestone.title}` +
              (bits.length > 0 ? ` — ${bits.join(' · ')}` : ''),
          );
        }
      }
    }
  }

  /* =====================================================================
   * 4. Tasks
   * ================================================================== */

  blank();
  push('## 4. Tasks', '');

  const open = data.tasks.filter((t) => !t.completedAt);
  const overdue = open
    .filter((t) => t.scheduledFor !== null && t.scheduledFor < today)
    .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''));
  const dueToday = open.filter((t) => t.scheduledFor === today);
  const ahead = open.filter((t) => t.scheduledFor !== null && t.scheduledFor > today);
  const backlog = open.filter((t) => t.scheduledFor === null);

  push(
    `${open.length} open, ${data.tasks.length - open.length} done. ` +
      `${overdue.length} overdue, ${dueToday.length} on today, ${ahead.length} scheduled ahead, ${backlog.length} in the backlog.`,
  );

  const taskGroup = (heading: string, rows: Task[], byDay: boolean): void => {
    blank();
    push(`### ${heading}`, '');
    if (rows.length === 0) {
      push('_None._');
      return;
    }
    if (!byDay) {
      for (const task of rows) push(taskLine(task));
      return;
    }
    const days = [...new Set(rows.map((t) => t.scheduledFor ?? ''))].sort();
    for (const key of days) {
      push(`**${day(key)}**`);
      for (const task of rows.filter((t) => t.scheduledFor === key).sort((a, b) => a.order - b.order)) {
        push(taskLine(task));
      }
      push('');
    }
  };

  taskGroup('Overdue', overdue, true);
  taskGroup('On today', dueToday, false);
  taskGroup('Scheduled ahead', ahead, true);
  taskGroup('Backlog (no day)', backlog, false);

  /* Completed work, grouped by the day it was finished rather than the day it
     was planned for — the second is what was intended, the first is what
     happened, and only one of them is evidence. */
  const completed = data.tasks
    .filter((t) => t.completedAt)
    .map((t) => ({ task: t, on: stampDay(t.completedAt) ?? '' }))
    .sort((a, b) => b.on.localeCompare(a.on));

  blank();
  push('### Completed, newest first', '');
  if (completed.length === 0) {
    push('_None._');
  } else {
    let current = '';
    for (const { task, on } of completed) {
      if (on !== current) {
        current = on;
        push('', `**${on ? day(on) : 'date unknown'}**`);
      }
      push(taskLine(task));
    }
  }

  /* =====================================================================
   * 5. Habits
   * ================================================================== */

  blank();
  push('## 5. Habits', '');
  if (data.habits.length === 0) {
    push('_None._');
  } else {
    for (const habit of [...data.habits].sort((a, b) => a.order - b.order)) {
      const streak = habitStreak(data, habit.id, today);
      const area = habit.areaId ? areaById.get(habit.areaId) : null;
      const goal = habit.goalId ? goalById.get(habit.goalId) : null;

      blank();
      push(`### ${habit.name}`, '');
      const facts = [`cadence: ${cadenceLabel(habit.cadence)}`, `area: ${area?.name ?? 'unfiled'}`];
      if (goal) facts.push(`compounds toward: ${goal.title}`);
      if (habit.archivedAt) facts.push(`archived ${stampDay(habit.archivedAt)}`);
      facts.push(`started ${stampDay(habit.createdAt) ?? habit.createdAt}`);
      push(`- ${facts.join(' · ')}`);
      push(
        `- Streak: ${streak.current} now, ${streak.best} at best · logged ${streak.total} days in total` +
          (streak.dueToday ? ' · due today and not yet done' : '') +
          (streak.doneToday ? ' · done today' : ''),
      );

      /* Every logged day, grouped by month so a year of a daily habit is a
         dozen lines rather than three hundred and sixty-five. Nothing is
         dropped: the dates are all here, and a reader can line them up against
         the training and food days below. */
      const logged = data.habitLogs
        .filter((log) => log.habitId === habit.id)
        .map((log) => log.date)
        .sort();
      if (logged.length > 0) {
        const months = new Map<string, string[]>();
        for (const date of logged) {
          const month = date.slice(0, 7);
          const list = months.get(month) ?? [];
          list.push(date.slice(8));
          months.set(month, list);
        }
        push('', 'Days logged:');
        for (const [month, days] of [...months.entries()].sort()) {
          push(`- ${month}: ${days.join(', ')} (${days.length})`);
        }
      }
    }
  }

  /* =====================================================================
   * 6. Training
   * ================================================================== */

  blank();
  push('## 6. Training', '');

  const trainingDays = [
    ...new Set([...data.exercises.map((e) => e.date), ...Object.keys(data.workoutDays)]),
  ].sort((a, b) => b.localeCompare(a));

  if (trainingDays.length === 0) {
    push('_Nothing logged._');
  } else {
    /* A per-week line first: it is the number that actually answers "am I
       doing more than last month", and it is tedious to add up by hand. */
    const weeks = [...new Set(trainingDays.map((d) => weekStartKey(d)))].sort((a, b) =>
      b.localeCompare(a),
    );
    push('Week totals, most recent first (Mon–Sun, derived from the sessions below):', '');
    push(`| Week beginning | Sessions | Exercises | Sets | Volume (${data.settings.loadUnit}) |`);
    push('| --- | --- | --- | --- | --- |');
    for (const monday of weeks) {
      const totals = weekTraining(data, monday);
      push(
        `| ${day(monday)}${monday > today ? ' (planned)' : ''} | ${totals.sessions} | ${totals.exercises} | ${totals.sets} | ${Math.round(totals.volume)} |`,
      );
    }

    for (const date of trainingDays) {
      const session = data.workoutDays[date];
      const exercises = data.exercises
        .filter((e) => e.date === date)
        .sort((a, b) => a.order - b.order);
      const plan = session?.planId ? planById.get(session.planId) : null;

      blank();
      const title = session?.name?.trim() ? ` — ${session.name.trim()}` : '';
      push(`### ${dayLong(date)}${title}${tense(date, today)}`, '');
      if (plan) push(`Laid out from the plan "${plan.name}".`, '');

      if (exercises.length === 0) {
        push('_Named, but nothing logged in it._');
        continue;
      }

      push(`| Exercise | Sets | Reps | Load (${data.settings.loadUnit}) | Volume | Done |`);
      push('| --- | --- | --- | --- | --- | --- |');
      let sets = 0;
      let volume = 0;
      for (const exercise of exercises) {
        sets += exercise.sets;
        volume += exerciseVolume(exercise);
        push(
          `| ${exercise.name} | ${exercise.sets} | ${exercise.reps} | ${exercise.load} | ` +
            `${Math.round(exerciseVolume(exercise))} | ${exercise.completedAt ? 'yes' : 'no'} |`,
        );
      }
      push('', `Session: ${exercises.length} exercises, ${sets} sets, ${Math.round(volume)} ${data.settings.loadUnit} of volume (derived).`);
    }
  }

  /* ---- the plans themselves ---- */
  blank();
  push('### Workout plans kept', '');
  if (data.workoutPlans.length === 0) {
    push('_None._');
  } else {
    for (const plan of [...data.workoutPlans].sort((a, b) => a.order - b.order)) {
      const totals = planTotals(plan);
      const used = planUseCount(data, plan.id);
      blank();
      push(
        `**${plan.name}** — ${plan.items.length} exercises, ${totals.sets} sets, ` +
          `${Math.round(totals.volume)} ${data.settings.loadUnit} of volume as written · assigned to ${used} ${used === 1 ? 'day' : 'days'}`,
      );
      for (const item of [...plan.items].sort((a, b) => a.order - b.order)) {
        push(`- ${item.name} — ${item.sets} × ${item.reps} @ ${item.load} ${data.settings.loadUnit}`);
      }
    }
    push(
      '',
      '_A plan\'s loads are a starting point only. What lands on a day is what was lifted the last time that plan was run._',
    );
  }

  /* =====================================================================
   * 7. Food
   * ================================================================== */

  blank();
  push('## 7. Food', '');

  const foodDays = [...new Set(data.food.map((f) => f.date))].sort((a, b) => b.localeCompare(a));
  if (foodDays.length === 0) {
    push('_Nothing logged._');
  } else {
    push(`Target: ${data.settings.calorieTarget} kcal a day.`, '');
    push('| Day | Eaten | Vs target | Entries | Macros from weighed food |');
    push('| --- | --- | --- | --- | --- |');
    for (const date of foodDays) {
      const stats2 = calorieDay(data, date);
      const macros = dayMacros(data, date);
      push(
        `| ${day(date)}${date > today ? ' (planned)' : ''} | ${stats2.eaten} | ${stats2.over ? `+${stats2.eaten - stats2.target} over` : `${stats2.left} left`} | ` +
          `${stats2.entries} | ${macros ? macroLabel(macros) : '—'} |`,
      );
    }

    for (const date of foodDays) {
      const entries = data.food.filter((f) => f.date === date).sort((a, b) => a.order - b.order);
      const stats2 = calorieDay(data, date);

      blank();
      push(`### ${dayLong(date)} — ${stats2.eaten} of ${stats2.target} kcal${tense(date, today)}`, '');
      for (const entry of entries) {
        const from = entry.mealId ? mealById.get(entry.mealId) : null;
        push(
          `- **${entry.name}** — ${entry.calories} kcal` +
            (from ? ` (logged from the saved meal "${from.name}")` : '') +
            (entry.mealId && !from ? ' (from a saved meal that has since been deleted)' : ''),
        );
        for (const item of [...entry.items].sort((a, b) => a.order - b.order)) {
          push(`  - ${ingredientLine(item)}`);
        }
      }
      const macros = dayMacros(data, date);
      if (macros) push('', `Macros: ${macroLabel(macros)}.`);
    }
  }

  /* ---- the library ---- */
  blank();
  push('### Meals kept', '');
  if (data.meals.length === 0) {
    push('_None._');
  } else {
    for (const meal of [...data.meals].sort((a, b) => a.order - b.order)) {
      const used = mealUseCount(data, meal.id);
      const macros = mealMacros(meal);
      blank();
      push(
        `**${meal.name}** — ${mealCalories(meal)} kcal, ${meal.items.length} ingredients · ` +
          `logged ${used} ${used === 1 ? 'time' : 'times'}`,
      );
      for (const item of mealItems(meal)) push(`- ${ingredientLine(item)}`);
      if (macros) push(`- Macros: ${macroLabel(macros)}`);
    }
    push(
      '',
      '_A logged day holds a COPY of the meal as it was that day. Editing a meal here changes what is eaten next time and nothing about what is recorded above._',
    );
  }

  /* =====================================================================
   * 8. Reviews
   * ================================================================== */

  blank();
  push('## 8. Reviews', '');
  const reviews = [...data.reviews].sort((a, b) => b.date.localeCompare(a.date));
  if (reviews.length === 0) {
    push('_None written._');
  } else {
    for (const review of reviews) {
      blank();
      const scope = review.type === 'daily' ? dayLong(review.date) : `week beginning ${dayLong(review.date)}`;
      push(
        `### ${review.type === 'daily' ? 'Daily shutdown' : 'Weekly review'} — ${scope}`,
        '',
        `- Self-rating: ${review.rating === null ? 'not given' : `${review.rating}/5`}`,
      );
      const fields: [string, string | undefined][] = [
        ['Wins', review.reflections.wins],
        ['Challenges', review.reflections.challenges],
        ['Lessons', review.reflections.lessons],
        ['Grateful for', review.reflections.gratitude],
      ];
      for (const [label, value] of fields) {
        if (value && value.trim().length > 0) push(`- ${label}: ${oneLine(value)}`);
      }
      if (review.tomorrowBig3 && review.tomorrowBig3.length > 0) {
        push(`- Big 3 set for the next day: ${review.tomorrowBig3.join('; ')}`);
      }
      if (review.nextWeekFocus && review.nextWeekFocus.trim().length > 0) {
        push(`- Focus set for the next week: ${oneLine(review.nextWeekFocus)}`);
      }
    }
  }

  /* =====================================================================
   * 9. Weekly focus
   * ================================================================== */

  blank();
  push('## 9. Weekly focus', '');
  const weekKeys = Object.keys(data.weeks).sort((a, b) => b.localeCompare(a));
  const withFocus = weekKeys.filter((k) => data.weeks[k].focus.trim().length > 0);
  if (withFocus.length === 0) {
    push('_None set._');
  } else {
    for (const key of withFocus) {
      push(`- Week beginning ${day(key)}: ${oneLine(data.weeks[key].focus)}`);
    }
  }

  /* =====================================================================
   * 10. Inbox
   * ================================================================== */

  blank();
  push('## 10. Inbox — captured, not yet filed', '');
  if (data.inbox.length === 0) {
    push('_Empty._');
  } else {
    for (const item of [...data.inbox].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      push(`- ${oneLine(item.text)} — captured ${stampDay(item.createdAt) ?? item.createdAt}`);
    }
  }

  blank();
  push('---', '');
  push(
    '_End of export. Every field in the document that carries meaning is above; only internal ids and sort positions were left out. The machine-readable original is available from the same menu as "Export JSON"._',
  );

  const markdown = `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  return {
    markdown,
    meta: { characters: markdown.length, approxTokens: Math.round(markdown.length / 4) },
  };
}

/** One ingredient, saying whether it was weighed and what off. */
function ingredientLine(item: FoodItem): string {
  if (!isWeighed(item) || item.grams === undefined || item.per100 === undefined) {
    return `${item.name} — ${item.calories} kcal`;
  }
  const { grams, per100 } = item;
  return (
    `${item.name} — ${round1(grams)} g @ ${round1(per100.kcal)} kcal/100 g = ${item.calories} kcal ` +
    `(per 100 g: ${round1(per100.protein)} P, ${round1(per100.fat)} F, ${round1(per100.carbs)} C)`
  );
}

