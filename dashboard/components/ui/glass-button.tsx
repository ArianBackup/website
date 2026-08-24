'use client';

/* GlassButton — Petr Knoll "Glass Button" (21st.dev port, provided by the owner).
 * The glass visuals live in theme-v2.css (.glass-button* rules); this file is the
 * markup + size variants. Promoted from app/style-lab to components/ui for
 * app-wide use (the primary CTA "Haze light" button).
 * Source: https://codepen.io/Petr-Knoll/pen/QwWLZdx */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@web/lib/general/utils';

const glassButtonVariants = cva(
  'relative isolate cursor-pointer rounded-full transition-all',
  {
    variants: {
      // The glass visuals in theme-v2.css hardcode `.glass-button { font-size: 1rem }`,
      // which outweighs a plain `text-sm`/`text-lg` class — so the size prop had no
      // effect (everything is em-based, so it all stayed at the 1rem scale). The `!`
      // makes these font-sizes win, and padding/glow/shadow scale with them.
      size: {
        default: '!text-base font-medium',
        sm: '!text-sm font-medium',
        lg: '!text-lg font-medium',
        icon: 'h-10 w-10',
        // Opt out of the glass scale entirely — the caller pins the box with
        // GLASS_BOX (or its own buttonClassName / contentClassName).
        none: '',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const glassButtonTextVariants = cva(
  'glass-button-text relative block select-none tracking-tighter',
  {
    variants: {
      size: {
        default: 'px-6 py-3.5',
        sm: 'px-4 py-2',
        lg: 'px-8 py-4',
        icon: 'flex h-10 w-10 items-center justify-center',
        none: '',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

/* Pin a glass button to an exact box, so it matches the plain buttons beside it.
 *
 * Two things have to be set together. The glass geometry (border width, blur,
 * inner dome, glow reach) is all em-based off the BUTTON's font-size, and
 * theme-v2 gives the LABEL an em padding of its own (`padding: 0.875em 1.5em`)
 * that a plain utility class can't outrank — so the size comes from the
 * font-size on the button plus important padding on the label, where
 *   padding-block = (target height - line-height) / 2
 * using Tailwind's line-heights (text-xs 16px, text-sm 20px, text-base 24px,
 * text-lg 28px). Use with `size="none"`. */
export const GLASS_BOX = {
  h8: { button: '!text-xs', content: '!px-3 !py-2' },
  h9: { button: '!text-xs', content: '!px-4 !py-2.5' },
  h10: { button: '!text-sm', content: '!px-4 !py-2.5' },
  h11: { button: '!text-sm', content: '!px-6 !py-3' },
  h12: { button: '!text-base', content: '!px-8 !py-3' },
  h14: { button: '!text-lg', content: '!px-10 !py-3.5' },
  icon8: { button: '!text-xs', content: '!size-8 !p-0' },
  icon9: { button: '!text-xs', content: '!size-9 !p-0' },
  icon10: { button: '!text-sm', content: '!size-10 !p-0' },
} as const;

export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof glassButtonVariants> {
  contentClassName?: string;
  /** Classes for the inner <button> (the glass surface). `className` styles the
   *  wrapper, which is where layout and the --haze-* variant live. */
  buttonClassName?: string;
}

const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, children, size, contentClassName, buttonClassName, ...props }, ref) => {
    // w-fit keeps the wrap (and its shadow layer, which is sized to 100% of the
    // wrap) content-width in any block/form context, so the shadow can't render
    // as a wide ghost pill behind the button.
    return (
      <div className={cn('glass-button-wrap w-fit cursor-pointer rounded-full', className)}>
        <button
          className={cn('glass-button', glassButtonVariants({ size }), buttonClassName)}
          ref={ref}
          {...props}
        >
          <span className={cn(glassButtonTextVariants({ size }), contentClassName)}>{children}</span>
        </button>
        <div className="glass-button-shadow rounded-full" />
      </div>
    );
  }
);
GlassButton.displayName = 'GlassButton';

export { GlassButton, glassButtonVariants };
