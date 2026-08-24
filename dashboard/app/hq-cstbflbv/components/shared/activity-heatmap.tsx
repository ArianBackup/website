'use client';

/* ---------------------------------------------------------------------------
 * ActivityHeatmap — this month, as a GitHub contribution graph.
 *
 * One cell per day, shaded by VOLUME: how many things you actually closed out
 * that day — tasks finished plus habits logged. Not the ratio. A day where you
 * planned one thing and did it is not the same as a day where you closed
 * eleven, and the ratio flattens exactly the difference the graph exists to
 * show.
 *
 * THE SHAPE
 * ---------
 * Seven weekday columns by six week rows — the month's own shape rather than
 * GitHub's long ribbon, because the window here is a single month and a ribbon
 * five columns wide is a sliver. Everything else is kept: bare heat squares
 * with no day numbers on them, the five-step ramp, the ring on today.
 *
 * The one exception is the day in progress, which carries its date inside the
 * cell. It is the only square you ever need to locate by number — every other
 * one is found by counting off the weekday header — and the ring alone says
 * "here" without saying which date "here" is.
 *
 * The grid draws exactly the rows the month needs — five for most, six for the
 * ones that straddle. Reserving six every time was the first cut, to pin the
 * tile's height; it bought a stable height in the rare month at the cost of a
 * visibly empty row in the common one, which is the wrong way round. The tile
 * now changes height by one row at a month boundary, which is a thing that
 * happens at midnight on the 1st and that nobody is watching.
 *
 * Days outside the month are not drawn at all — not even as a faint spill. The
 * grid holds one month and only one month.
 *
 * The caption, the count and the ramp key sit in a rail down the right rather
 * than stacked above and below. A month grid is close to square, so laid out
 * vertically it would either leave half the tile empty or squash the cells into
 * bricks; moved to the side, the same tile carries cells at roughly twice the
 * size the twelve-week ribbon could manage.
 *
 * THE RAMP
 * --------
 * Levels are quartiles of YOUR OWN busiest day this month, the way GitHub
 * scales to the author rather than to an absolute. Someone closing four things
 * a day gets the same full spread as someone closing thirty, and a quiet month
 * does not render as a uniformly pale sheet.
 *
 * Colour is all `--pa-heat-0…4` (see `.pa-heat-cell` in assistant.css), so the
 * light ramp and the dark one are the same five names and there is not a
 * literal colour in this file. "Today" comes from the provider's live day, so
 * the ringed cell moves on its own at midnight, without a refresh.
 * ------------------------------------------------------------------------- */

import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';

import { addDaysKey, dayNumber, formatKey, isoWeekday, toKey } from '../../lib/dates';
import { dayProgress } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { DayKey } from '../../lib/types';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/** Gap between cells, in px. Everything else about the grid is fluid. */
const GAP = 3;

/** Monday-first, matching the rest of the portal. */
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** The right-hand rail. Sized to hold the ramp key on one line. */
const RAIL = 78;

interface Cell {
  key: DayKey;
  /** 0–4 for a day already spent, -1 for one still ahead. */
  level: number;
  done: number;
  total: number;
}

/**
 * Quartiles of the busiest day of the month. `peak` of 0 never reaches here — a
 * month with nothing in it skips the call and leaves every cell at 0.
 */
function levelFor(done: number, peak: number): number {
  if (done <= 0) return 0;
  if (done >= peak) return 4;
  const share = done / peak;
  if (share > 0.66) return 3;
  if (share > 0.33) return 2;
  return 1;
}

export interface ActivityHeatmapProps {
  className?: string;
}

export function ActivityHeatmap({ className }: ActivityHeatmapProps): JSX.Element {
  const { data, today } = useAssistant();
  const reduce = useReducedMotion();

  const { rows, monthLabel, monthDone, daysSpent, daysInMonth, peak } = useMemo(() => {
    const now = new Date(`${today}T00:00:00`);
    const firstOfMonth = toKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastOfMonth = toKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const length = Number(lastOfMonth.slice(8, 10));

    /* Pass one: the month's own days, and its busiest. The ramp cannot be
     * assigned until the whole month is known, since the scale is relative to
     * its own peak. */
    const inMonth = new Map<DayKey, { done: number; total: number }>();
    let highest = 0;
    let done = 0;
    let spent = 0;
    for (let key = firstOfMonth; key <= lastOfMonth; key = addDaysKey(key, 1)) {
      const ahead = key > today;
      const progress = dayProgress(data, key);
      const closed = ahead ? 0 : progress.done;
      inMonth.set(key, { done: closed, total: progress.total });
      if (ahead) continue;
      spent += 1;
      done += closed;
      if (closed > highest) highest = closed;
    }

    /* Pass two: lay the month out on a Monday-first grid. Slots outside it stay
     * null and render as nothing at all — the widget holds one month, so a
     * neighbouring month has no business drawing a cell here, not even a faint
     * one. */
    const lead = isoWeekday(firstOfMonth) - 1;
    const gridStart = addDaysKey(firstOfMonth, -lead);
    const rowCount = Math.ceil((lead + length) / 7);
    const grid: (Cell | null)[][] = [];
    for (let row = 0; row < rowCount; row += 1) {
      const week: (Cell | null)[] = [];
      for (let column = 0; column < 7; column += 1) {
        const key = addDaysKey(gridStart, row * 7 + column);
        const entry = inMonth.get(key);
        week.push(
          entry === undefined
            ? null
            : {
                key,
                level: key > today ? -1 : highest === 0 ? 0 : levelFor(entry.done, highest),
                done: entry.done,
                total: entry.total,
              },
        );
      }
      grid.push(week);
    }

    return {
      rows: grid,
      monthLabel: formatKey(today, 'MMMM'),
      monthDone: done,
      daysSpent: spent,
      daysInMonth: length,
      peak: highest,
    };
  }, [data, today]);

  const gridTemplate = {
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: `${GAP}px`,
  } as const;

  const summary =
    monthDone === 0
      ? `${monthLabel}: nothing closed out across the ${daysSpent} ${
          daysSpent === 1 ? 'day' : 'days'
        } spent so far.`
      : `${monthLabel}: ${monthDone} things closed out across the ${daysSpent} ${
          daysSpent === 1 ? 'day' : 'days'
        } spent so far, of ${daysInMonth}. Busiest day: ${peak}.`;

  return (
    <div className={clsx('pa-tile flex w-full min-w-0 items-stretch gap-3 p-3.5', className)}>
      {/* ---- the month ---- */}
      <div className="min-w-0 flex-1" role="img" aria-label={summary}>
        <div className="grid" style={gridTemplate} aria-hidden>
          {WEEKDAY_INITIALS.map((initial, column) => (
            <span
              key={column}
              className="mb-0.5 text-center text-[9px] font-medium leading-none text-[color:var(--pa-faint)]"
            >
              {initial}
            </span>
          ))}
        </div>

        <div className="grid" style={gridTemplate} aria-hidden>
          {rows.map((week, row) => (
            <motion.div
              key={row}
              className="col-span-7 grid"
              style={gridTemplate}
              initial={reduce ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, delay: row * 0.035, ease: HOUSE_EASE }}
            >
              {week.map((cell, column) =>
                cell === null ? (
                  <span key={column} className="aspect-square w-full" />
                ) : (
                  <div
                    key={cell.key}
                    className="pa-heat-cell aspect-square w-full"
                    data-level={cell.level < 0 ? 0 : cell.level}
                    data-future={cell.level < 0 ? 'true' : undefined}
                    data-today={cell.key === today ? 'true' : undefined}
                    data-tip={`${formatKey(cell.key, 'EEE d MMM')} — ${
                      cell.level < 0
                        ? cell.total === 0
                          ? 'nothing planned yet'
                          : `${cell.total} planned`
                        : `${cell.done} done`
                    }`}
                  >
                    {cell.key === today ? (
                      <span className="pa-heat-day">{dayNumber(cell.key)}</span>
                    ) : null}
                  </div>
                ),
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* ---- the readout ---- */}
      {/* A basis rather than a fixed width: the rail is 78px of a 260px tile at
          360px, and the month label truncates to about six characters. */}
      <div className="flex shrink-0 basis-[68px] flex-col sm:basis-[var(--pa-rail)]" style={{ ['--pa-rail' as string]: `${RAIL}px` }}>
        <p className="pa-eyebrow truncate">{monthLabel}</p>

        <p className="mt-1.5 text-[19px] tabular-nums leading-none text-[color:var(--pa-navy)]">
          {monthDone}
          <span className="ml-1 text-[11px] text-[color:var(--pa-faint)]">done</span>
        </p>

        {/* One line, at 78px — "days spent" would wrap the count onto its own
            row and the rail would read as two unrelated numbers. */}
        <p className="mt-1.5 text-[10.5px] sm:whitespace-nowrap leading-none text-[color:var(--pa-faint)]">
          <span className="tabular-nums">
            {daysSpent}/{daysInMonth}
          </span>{' '}
          days
        </p>

        {/* The ramp, spelled out. Pinned to the bottom of the rail so it lines
            up with the last week of the grid however tall the tile ends up. */}
        <div className="mt-auto pt-3" aria-hidden>
          <p className="mb-1 text-[9px] leading-none text-[color:var(--pa-faint)]">Less → More</p>
          <div className="flex items-center gap-[2px]">
            {[0, 1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className="pa-heat-cell pointer-events-none size-[9px]"
                data-level={level}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
