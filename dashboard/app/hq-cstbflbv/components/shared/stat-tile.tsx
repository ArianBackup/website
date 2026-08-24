'use client';

/* ---------------------------------------------------------------------------
 * StatTile — one number, said once, said well.
 *
 * A raised inner surface with four bands of information, in descending order
 * of importance read bottom-up: the numeral, its unit, the label above it and
 * a quiet line of context underneath. The icon chip is the only colour on the
 * tile, so `tone` tints exactly that and nothing else — the numeral keeps the
 * house KPI gradient in every state, which is what makes a row of these read
 * as one instrument panel rather than a traffic light.
 *
 * Every colour here is a token, so the tile flips with the theme: the tints are
 * mixed FROM `--pa-green` / `--pa-amber` / `--pa-accent-glow` rather than
 * written as literals, because a wash that reads as a halo on white disappears
 * against the navy-black stage — the tokens already carry that correction.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface StatTileProps {
  /** Micro-label above the numeral, e.g. `'Tasks done'`. */
  label: string;
  value: number | string;
  /** Unit or qualifier set beside the numeral, e.g. `'%'` or `'days'`. */
  suffix?: string;
  /** One short line of context beneath. */
  hint?: string;
  icon?: LucideIcon;
  /** Tints the icon chip only. */
  tone?: 'default' | 'green' | 'amber';
  className?: string;
}

/**
 * Chip fill / ink / hairline per tone. `default` inherits `.pa-chip`'s azure.
 *
 * The inline `boxShadow` replaces the class's entirely, so it has to carry the
 * inset top highlight itself — `--pa-highlight` rather than a white literal,
 * which would draw a bright lip across the chip on the dark stage.
 */
const TONE_CHIP: Record<'green' | 'amber', CSSProperties> = {
  green: {
    background: 'var(--pa-green-bg)',
    color: 'var(--pa-green)',
    boxShadow:
      'inset 0 0 0 1px color-mix(in srgb, var(--pa-green) 26%, transparent), var(--pa-highlight)',
  },
  amber: {
    background: 'var(--pa-amber-bg)',
    color: 'var(--pa-amber)',
    boxShadow:
      'inset 0 0 0 1px color-mix(in srgb, var(--pa-amber) 26%, transparent), var(--pa-highlight)',
  },
};

/**
 * The corner bloom behind the chip. Built from an already-translucent token so
 * one expression works on both themes: the light theme's washes are quiet, the
 * dark theme's are deliberately stronger, and mixing the same token down for
 * the outer stop keeps the falloff identical either way.
 */
function bloom(tint: string): string {
  return `radial-gradient(closest-side, ${tint}, color-mix(in srgb, ${tint} 30%, transparent) 58%, transparent 78%)`;
}

const TONE_BLOOM: Record<'default' | 'green' | 'amber', string> = {
  default: bloom('var(--pa-accent-glow)'),
  green: bloom('var(--pa-green-bg)'),
  amber: bloom('var(--pa-amber-bg)'),
};

/** Thousands separators on real numbers; anything else is passed straight through. */
function formatValue(value: number | string): string {
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

export function StatTile({
  label,
  value,
  suffix,
  hint,
  icon: Icon,
  tone = 'default',
  className,
}: StatTileProps): JSX.Element {
  const display = formatValue(value);
  const chipStyle = tone === 'default' ? undefined : TONE_CHIP[tone];

  return (
    <div className={clsx('pa-tile relative overflow-hidden p-4', className)}>
      {/* A breath of colour in the corner so the chip sits in light, not on paper. */}
      {Icon ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-7 -top-9 size-24 rounded-full"
          style={{ background: TONE_BLOOM[tone] }}
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] font-medium uppercase leading-[1.35] tracking-[0.11em] text-[color:var(--pa-muted)]">
          {label}
        </p>

        {Icon ? (
          <span
            className="pa-chip size-8 shrink-0 rounded-[0.7rem]"
            style={chipStyle}
            aria-hidden="true"
          >
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        ) : null}
      </div>

      <p className="relative mt-3 flex items-baseline gap-1.5">
        <span className="pa-stat text-[1.75rem] tabular-nums">{display}</span>
        {suffix ? (
          <span className="text-[13px] font-medium leading-none text-[color:var(--pa-muted)]">
            {suffix}
          </span>
        ) : null}
      </p>

      {hint ? (
        <p className="relative mt-1.5 text-[11.5px] leading-snug text-[color:var(--pa-faint)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
