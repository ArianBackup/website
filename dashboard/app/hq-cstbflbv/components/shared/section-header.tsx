'use client';

/* ---------------------------------------------------------------------------
 * SectionHeader — the standing header for every panel in the portal.
 *
 * Eyebrow over title over subtitle on the left, an optional action node pinned
 * right, an optional icon in a soft azure chip. Nothing else: the whitespace
 * around it does the work.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  /** Uppercase micro-label above the title. */
  eyebrow?: string;
  title: string;
  /** One quiet sentence of context. */
  subtitle?: string;
  /** Rendered inside a `.pa-chip` to the left of the text block. */
  icon?: LucideIcon;
  /**
   * Controls pinned to the right edge. At most ONE of them is the surface's
   * primary action and takes the haze-light `GlassButton`; everything else
   * beside it stays a `.pa-cta`, `.pa-btn` or `.pa-icon-btn`.
   */
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  action,
  className,
}: SectionHeaderProps): JSX.Element {
  /* ---- why this wraps instead of staying a row ----
   * The action is `shrink-0` and some of them are wide ("Carry over 3
   * unfinished" is 240px). On a 390px screen the title column got what was
   * left, which on the week view was about 40px — "Week of 3 — 9 August" came
   * out one word per line, under a button sitting on top of it.
   *
   * `flex-wrap` with the text block at `basis-full sm:basis-0` puts the action
   * on its own line below the title on a phone and back on the right from 640px
   * up, where there has always been room for both. `w-full sm:w-auto` on the
   * action row then lets a wide button use the width it just gained rather than
   * hugging the left edge under a full-width title. */
  return (
    <div
      className={clsx(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-3',
        className,
      )}
    >
      <div className="flex min-w-0 shrink basis-full items-start gap-3 sm:basis-0 sm:flex-1">
        {Icon ? (
          <span className="pa-chip mt-0.5 size-9 shrink-0" aria-hidden="true">
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </span>
        ) : null}

        <div className="min-w-0">
          {eyebrow ? <p className="pa-eyebrow mb-1.5 leading-none">{eyebrow}</p> : null}

          <h2 className="pa-title text-[17px] leading-snug">{title}</h2>

          {subtitle ? (
            <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-[color:var(--pa-muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {action ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">{action}</div>
      ) : null}
    </div>
  );
}
