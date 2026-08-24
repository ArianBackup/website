'use client';

/* ---------------------------------------------------------------------------
 * toaster.tsx — sonner, mounted once.
 *
 * The portal calls `toast()` from a dozen places and needs a host for them.
 * Sculptr's version of this sat behind next-themes, react-query, an intl
 * provider and athli's global-data provider; none of that is load-bearing for
 * a toast, so this is the wrapper reduced to what it actually does — the same
 * icons and the same token-driven surface, and no provider tree behind it.
 *
 * `theme="light"` rather than "system": the portal has its OWN light/dark that
 * is nothing to do with `prefers-color-scheme` (dark is a live map of London),
 * and a toast that followed the OS while the page followed the toggle would
 * disagree with the surface it lands on about half the time.
 * ------------------------------------------------------------------------- */

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner } from 'sonner';

export function Toaster(): JSX.Element {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
    />
  );
}
