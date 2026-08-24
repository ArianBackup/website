'use client';

/* ---------------------------------------------------------------------------
 * HabitHeatmap — half a year of a habit, at a glance.
 *
 * Seven rows (Mon…Sun) by N week columns, ending on the week that contains
 * `endDay`. A day is binary — logged or not — so rather than fake five levels
 * of intensity we use the ramp for RECENCY: the last eight weeks burn at level
 * 4, everything older settles to level 3. The eye reads "am I still doing this"
 * before it reads "have I ever done this", which is the question that matters.
 *
 * The grid is fixed-geometry (11px cells, 3px gutters) and scrolls inside a
 * hidden-scrollbar rail, so it never widens its parent on a narrow screen.
 *
 * The ramp is entirely `--pa-heat-0…4` (see `.pa-heat-cell` in assistant.css),
 * which is why there is not a single colour in this file: the light theme's
 * azure ramp and the dark theme's brighter one are the same five names.
 *
 * "Today" comes from the provider's live day, so the ringed cell walks one
 * column at midnight without a refresh.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import { useEffect, useMemo, useRef } from 'react';

import { addDaysKey, daysBetween, formatKey, weekDaysFrom, weekStartKey } from '../../lib/dates';
import { useAssistant } from '../../lib/store';
import type { DayKey } from '../../lib/types';

export interface HabitHeatmapProps {
  /** Every day this habit was logged, from `habitLogDays()`. */
  days: Set<DayKey>;
  /** Week columns to draw. Clamped to 1…104. */
  weeks?: number;
  /** The last day shown. Defaults to the live current day. */
  endDay?: DayKey;
  className?: string;
}

const CELL = 11;
const GAP = 3;
/** Width of the weekday gutter — enough for a 9px 'W' plus breathing room. */
const GUTTER = 18;
/** Logged days at or inside this age burn at full strength. */
const RECENT_DAYS = 56;
/** Below this many columns a month segment is too thin to caption. */
const MIN_LABEL_SPAN = 3;

/** Mon…Sun, captioned sparsely so the gutter stays quiet. */
const ROW_LABELS = ['M', '', 'W', '', 'F', '', ''];

interface MonthSegment {
  key: string;
  label: string;
  /** 1-indexed grid column where the month's first week sits. */
  start: number;
  span: number;
}

function clampWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return 26;
  return Math.min(104, Math.max(1, Math.trunc(weeks)));
}

export function HabitHeatmap({
  days,
  weeks = 26,
  endDay,
  className,
}: HabitHeatmapProps): JSX.Element {
  const { today } = useAssistant();
  const end = endDay ?? today;
  const weekCount = clampWeeks(weeks);

  const { columns, months, loggedCount, totalCount } = useMemo(() => {
    const lastMonday = weekStartKey(end);
    const firstMonday = addDaysKey(lastMonday, -(weekCount - 1) * 7);

    const cols: DayKey[][] = [];
    for (let i = 0; i < weekCount; i += 1) {
      cols.push(weekDaysFrom(addDaysKey(firstMonday, i * 7)));
    }

    /* Month captions sit above the first column that opens a new month. */
    const segments: MonthSegment[] = [];
    for (let i = 0; i < cols.length; i += 1) {
      const column = cols[i];
      const monday = column[0];
      if (monday === undefined) continue;
      const stamp = formatKey(monday, 'yyyy-MM');
      const previous = segments[segments.length - 1];
      if (previous && previous.key === stamp) {
        previous.span += 1;
      } else {
        segments.push({ key: stamp, label: formatKey(monday, 'MMM'), start: i + 1, span: 1 });
      }
    }

    let logged = 0;
    let total = 0;
    for (const column of cols) {
      for (const day of column) {
        if (day > end) continue;
        total += 1;
        if (days.has(day)) logged += 1;
      }
    }

    return { columns: cols, months: segments, loggedCount: logged, totalCount: total };
  }, [days, end, weekCount]);

  const gridTemplate = {
    gridTemplateColumns: `repeat(${weekCount}, ${CELL}px)`,
    columnGap: `${GAP}px`,
  } as const;

  const summary =
    totalCount === 0
      ? 'No history yet.'
      : `Habit history: ${loggedCount} of ${totalCount} days completed across the last ${weekCount} ${
          weekCount === 1 ? 'week' : 'weeks'
        }.`;

  /* Scrolled to the RIGHT edge on arrival.
   *
   * The grid is 26 weeks × 11px plus gaps — 379px inside a 292px card at
   * 360px — so the last six weeks arrive off-screen, INCLUDING the ringed
   * `data-today` cell. That is precisely the "am I still doing this" question
   * this component exists to answer. Nothing to scroll when the grid fits, so
   * a desktop is untouched. */
  const rail = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rail.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weekCount, end]);

  return (
    <div className={clsx('w-full min-w-0', className)}>
      <div
        ref={rail}
        className="pa-scroll-x -mx-1 px-1 pb-1"
        data-fade="true"
        role="img"
        aria-label={summary}
      >
        <div className="w-max" aria-hidden="true">
          {/* ---- month captions ---- */}
          <div className="flex">
            <div style={{ width: `${GUTTER}px` }} />
            <div className="grid" style={gridTemplate}>
              {months.map((month) =>
                month.span >= MIN_LABEL_SPAN ? (
                  <span
                    key={month.key}
                    className="truncate text-[9.5px] font-medium leading-none tracking-[0.06em] text-[color:var(--pa-faint)]"
                    style={{ gridColumn: `${month.start} / span ${month.span}` }}
                  >
                    {month.label}
                  </span>
                ) : (
                  <span
                    key={month.key}
                    style={{ gridColumn: `${month.start} / span ${month.span}` }}
                  />
                ),
              )}
            </div>
          </div>

          {/* ---- weekday gutter + cells ---- */}
          <div className="mt-1.5 flex">
            <div
              className="flex flex-col justify-between pr-1.5 text-right"
              style={{ width: `${GUTTER}px`, gap: `${GAP}px` }}
            >
              {ROW_LABELS.map((label, row) => (
                <span
                  key={row}
                  className="text-[9px] font-medium leading-none text-[color:var(--pa-faint)]"
                  style={{ height: `${CELL}px`, lineHeight: `${CELL}px` }}
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="grid" style={gridTemplate}>
              {columns.map((column, index) => {
                const anchor = column[0] ?? `col-${index}`;
                return (
                  <div key={anchor} className="flex flex-col" style={{ gap: `${GAP}px` }}>
                    {column.map((day) => {
                      /* Days past the window keep the geometry, draw nothing. */
                      if (day > end) {
                        return <div key={day} className="size-[11px]" />;
                      }

                      const logged = days.has(day);
                      const level = logged ? (daysBetween(day, end) > RECENT_DAYS ? 3 : 4) : 0;

                      return (
                        <div
                          key={day}
                          className="pa-heat-cell size-[11px]"
                          data-level={level}
                          data-today={day === today ? 'true' : undefined}
                          data-tip={`${formatKey(day, 'd MMM yyyy')} — ${logged ? 'done' : 'not done'}`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* The per-cell dates live only in `data-tip`, which never fires on touch,
          and the only other affordance is a hover scale. The summary is already
          computed for the `aria-label`; on a phone it is the readout. */}
      <p className="mt-2 text-[12px] leading-snug text-[color:var(--pa-muted)] sm:hidden">
        {summary}
      </p>
    </div>
  );
}
