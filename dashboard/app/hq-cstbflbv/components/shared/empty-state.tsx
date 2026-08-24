'use client';

/* ---------------------------------------------------------------------------
 * EmptyState — nothing here yet, said with confidence.
 *
 * An empty surface is a first impression, not an error: a haloed chip, one
 * clear line, one quiet sentence, and the way forward underneath.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import { Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /**
   * The one obvious next move. An empty surface has exactly one primary
   * action, so this is the place for the haze-light `GlassButton`; anything
   * secondary beside it stays a `.pa-cta`.
   */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Sparkles,
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={clsx(
        'pa-rise flex flex-col items-center justify-center px-6 py-14 text-center',
        className,
      )}
    >
      <div className="relative">
        {/* A soft azure bloom so the chip sits in light rather than on flat
         * paper. Built from `--pa-accent-glow`, which is deliberately stronger
         * in dark mode — a wash that reads as a halo on white would vanish
         * entirely against the navy-black stage. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-5 rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, var(--pa-accent-glow), color-mix(in srgb, var(--pa-accent-glow) 34%, transparent) 58%, transparent 78%)',
          }}
        />
        <span className="pa-chip relative size-12 rounded-[1.05rem]" aria-hidden="true">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      </div>

      <h3 className="pa-title mt-5 text-[15px] leading-snug">{title}</h3>

      {description ? (
        <p className="mt-2 max-w-[38ch] text-[13px] leading-relaxed text-[color:var(--pa-muted)]">
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-6 flex items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
