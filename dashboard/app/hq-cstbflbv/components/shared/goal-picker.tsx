'use client';

/* ---------------------------------------------------------------------------
 * GoalPicker — the control that keeps the cascade honest.
 *
 * Anywhere a task, habit or capture can be tied to a goal, this is how. A
 * `.pa-input`-shaped trigger opens a searchable list grouped by life area, so
 * the choice is always made in the context of the part of life it serves.
 *
 * Radix portals the popover to <body>, which is outside `.assistant-shell` —
 * and every `.pa-*` class is scoped under it. Hence the shell wrapper inside
 * the content, with the full-page geometry neutralised.
 *
 * `pa-portal` strips the host kit's own fill, border, shadow and `rounded-lg`
 * off the portal container: it used to show as a second, squarer rectangle
 * around our rounded surface — the doubled corner. The surface inside now owns
 * every pixel, and `overflow-hidden` clips the command list to its radius so
 * the first and last rows cannot square it off again.
 *
 * The floating layer is positioned with a transform, so nothing in here may
 * use backdrop-filter (`.pa-cta`, `.pa-frost`): a transformed ancestor kills
 * it silently. The surface is the near-opaque `--pa-solid` fill instead, which
 * needs no blur to hold on either theme.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import { Check, ChevronsUpDown, CircleSlash, Target } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@web/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@web/components/ui/popover';

import { activeGoals } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import type { Goal, GoalHorizon, ID, LifeArea } from '../../lib/types';

export interface GoalPickerProps {
  value: ID | null;
  onChange: (goalId: ID | null) => void;
  placeholder?: string;
  className?: string;
}

const HORIZON_LABEL: Record<GoalHorizon, string> = {
  vision: 'Vision',
  year: 'Year',
  quarter: 'Quarter',
};

/**
 * Neutralises `.assistant-shell`'s page geometry so the class can be reused as
 * a token/scope carrier inside a portal without claiming a full viewport.
 */
const PORTAL_SHELL = { minHeight: 0, overflowX: 'visible' } as const;

/* The dialog sheet (`.pa-sheet`) is a 1.5rem panel, which is right for a modal
 * but far too round hanging off a 0.85rem input — so this is the same recipe at
 * the popover's own radius: `--pa-solid` body, `--pa-edge` lip, `--pa-shadow-xl`
 * lift. `overflow-hidden` is what makes the corner read as one clean curve. */
const SURFACE = clsx(
  'overflow-hidden rounded-[1.15rem] border',
  'border-[color:var(--pa-edge)] bg-[color:var(--pa-solid)]',
);

/* Tailwind reads `shadow-[var(…)]` as a shadow COLOUR rather than a box-shadow,
 * so the layered elevation is applied directly — on a surface INSIDE the shell
 * wrapper, which is the only place the var resolves. */
const SURFACE_SHADOW = { boxShadow: 'var(--pa-shadow-xl)' } as const;

/* Overrides for the host command kit — merged by tailwind-merge, so each of
 * these replaces the shadcn default of the same utility group. */
const CMD_ROOT = clsx(
  'bg-transparent text-[color:var(--pa-navy)]',
  '[&_[data-slot=command-input-wrapper]]:h-11',
  '[&_[data-slot=command-input-wrapper]]:gap-2',
  '[&_[data-slot=command-input-wrapper]]:px-3.5',
  '[&_[data-slot=command-input-wrapper]]:border-[color:var(--pa-line)]',
);

const CMD_GROUP = clsx(
  'p-1.5',
  '[&_[cmdk-group-heading]]:px-2',
  '[&_[cmdk-group-heading]]:pb-1',
  '[&_[cmdk-group-heading]]:pt-1.5',
  '[&_[cmdk-group-heading]]:text-[10px]',
  '[&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:uppercase',
  '[&_[cmdk-group-heading]]:tracking-[0.12em]',
  '[&_[cmdk-group-heading]]:text-[color:var(--pa-faint)]',
);

/* The highlight is a token wash plus a hairline ring: on white the wash alone
 * is enough, but on the dark sheet the ring is what gives the selected row an
 * edge to sit against. */
/** True on a touch device. */
function coarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

const CMD_ITEM = clsx(
  'min-h-11 sm:min-h-0',
  'flex cursor-pointer items-center gap-2.5 rounded-[0.75rem] px-2 py-2 text-[13px]',
  'data-[selected=true]:bg-[color:var(--pa-accent-bg)]',
  'data-[selected=true]:text-[color:var(--pa-navy)]',
  'data-[selected=true]:shadow-[inset_0_0_0_1px_var(--pa-accent-ring)]',
);

interface AreaBucket {
  area: LifeArea | null;
  goals: Goal[];
}

export function GoalPicker({
  value,
  onChange,
  placeholder = 'Link to a goal',
  className,
}: GoalPickerProps): JSX.Element {
  const { data } = useAssistant();
  const [open, setOpen] = useState(false);

  /* The selected goal is looked up across ALL goals, not just active ones —
   * a task linked to a goal that has since been achieved must still say so. */
  const selected = useMemo<Goal | null>(
    () => (value === null ? null : data.goals.find((goal) => goal.id === value) ?? null),
    [data.goals, value],
  );

  const selectedArea = useMemo<LifeArea | null>(() => {
    if (!selected || selected.areaId === null) return null;
    return data.areas.find((area) => area.id === selected.areaId) ?? null;
  }, [data.areas, selected]);

  const buckets = useMemo<AreaBucket[]>(() => {
    const goals = activeGoals(data);
    const ordered = [...data.areas].sort((a, b) => a.order - b.order);

    const byArea = new Map<ID, AreaBucket>();
    for (const area of ordered) byArea.set(area.id, { area, goals: [] });

    const unfiled: Goal[] = [];
    for (const goal of goals) {
      const bucket = goal.areaId === null ? undefined : byArea.get(goal.areaId);
      if (bucket) bucket.goals.push(goal);
      else unfiled.push(goal);
    }

    const result: AreaBucket[] = [];
    for (const bucket of byArea.values()) {
      if (bucket.goals.length > 0) result.push(bucket);
    }
    if (unfiled.length > 0) result.push({ area: null, goals: unfiled });
    return result;
  }, [data]);

  const hasGoals = buckets.length > 0;

  const choose = (goalId: ID | null): void => {
    onChange(goalId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Radix supplies aria-haspopup / aria-expanded / aria-controls through
            `asChild`, so the trigger stays a plain, correctly-labelled button. */}
        <button
          type="button"
          aria-label={selected ? `Linked goal: ${selected.title}. Change goal.` : placeholder}
          className={clsx(
            'pa-input flex h-10 w-full items-center gap-2 px-3 text-left text-[13.5px]',
            className,
          )}
        >
          {selected ? (
            <>
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: selectedArea?.color ?? 'var(--pa-azure)' }}
              />
              <span className="min-w-0 flex-1 truncate text-[color:var(--pa-navy)]">
                {selected.title}
              </span>
            </>
          ) : (
            <>
              <Target
                className="size-3.5 shrink-0 text-[color:var(--pa-faint)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[color:var(--pa-faint)]">
                {placeholder}
              </span>
            </>
          )}

          <ChevronsUpDown
            className="size-3.5 shrink-0 text-[color:var(--pa-faint)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        collisionPadding={12}
        align="start"
        sideOffset={6}
        className={clsx(
          'pa-portal',
          'w-[var(--radix-popover-trigger-width)] min-w-[264px] max-w-[min(380px,calc(100vw-1.5rem))]',
          'border-0 bg-transparent p-0 shadow-none',
        )}
      >
        <div className="assistant-shell" style={PORTAL_SHELL}>
          <div className={SURFACE} style={SURFACE_SHADOW}>
            <Command className={CMD_ROOT}>
              <CommandInput
                /* The keyboard would otherwise open the instant the popover does,
                   on a layer anchored to the layout viewport. The list is still
                   filterable by tapping the field. */
                autoFocus={!coarsePointer()}
                placeholder="Search goals…"
                className="h-11 text-[13.5px] placeholder:text-[color:var(--pa-faint)]"
              />

              <CommandList className="max-h-[min(46dvh,300px)]">
                <CommandEmpty className="px-4 py-8 text-center text-[12.5px] text-[color:var(--pa-muted)]">
                  No goal matches that.
                </CommandEmpty>

                <CommandGroup className={CMD_GROUP}>
                  <CommandItem
                    value="No goal — unlinked none clear"
                    onSelect={() => choose(null)}
                    className={CMD_ITEM}
                  >
                    <CircleSlash
                      className="size-3.5 shrink-0 text-[color:var(--pa-faint)]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[color:var(--pa-muted)]">
                      No goal
                    </span>
                    {value === null ? (
                      <Check
                        className="size-3.5 shrink-0 text-[color:var(--pa-azure)]"
                        strokeWidth={2.25}
                        aria-hidden="true"
                      />
                    ) : null}
                  </CommandItem>
                </CommandGroup>

                {hasGoals ? (
                  buckets.map((bucket) => (
                    <CommandGroup
                      key={bucket.area ? bucket.area.id : 'unfiled'}
                      heading={bucket.area ? bucket.area.name : 'Unfiled'}
                      className={CMD_GROUP}
                    >
                      {bucket.goals.map((goal) => (
                        <CommandItem
                          key={goal.id}
                          value={`${goal.title} ${bucket.area?.name ?? ''} ${goal.id}`}
                          onSelect={() => choose(goal.id)}
                          className={CMD_ITEM}
                        >
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: bucket.area?.color ?? 'var(--pa-azure)' }}
                          />
                          <span className="min-w-0 flex-1 truncate text-[color:var(--pa-navy)]">
                            {goal.title}
                          </span>
                          <span
                            className="pa-badge shrink-0"
                            data-tone={goal.horizon === 'quarter' ? 'azure' : undefined}
                          >
                            {HORIZON_LABEL[goal.horizon]}
                          </span>
                          {goal.id === value ? (
                            <Check
                              className="size-3.5 shrink-0 text-[color:var(--pa-azure)]"
                              strokeWidth={2.25}
                              aria-hidden="true"
                            />
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))
                ) : (
                  <CommandGroup className={CMD_GROUP}>
                    <CommandItem
                      value="no-goals-yet"
                      disabled
                      className={clsx(CMD_ITEM, 'cursor-default data-[disabled=true]:opacity-100')}
                    >
                      <Target
                        className="size-3.5 shrink-0 text-[color:var(--pa-faint)]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 text-[12.5px] text-[color:var(--pa-faint)]">
                        No goals yet — add one from the Goals view.
                      </span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
