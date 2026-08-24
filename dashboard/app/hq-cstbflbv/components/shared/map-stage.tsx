'use client';

/* ---------------------------------------------------------------------------
 * MapStage — the ground dark mode stands on.
 *
 * A live MapLibre map of London, fixed to the viewport and pinned behind every
 * panel in the portal. Nothing else about the theme changes: dark mode is the
 * dark ink family (see lib/theme.ts) with this in place of the navy stage.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a map you use. `interactive={false}` (see MapCanvas) turns off every
 * handler at source — scroll, drag, keyboard, double-click zoom — so a scroll
 * over the page cannot zoom Bloomsbury out from under a task list. The layer is
 * `pointer-events: none` on top of that, with one exception: the attribution
 * control takes its clicks back, because the OSM and CARTO credits have to stay
 * reachable.
 *
 * MOUNTING
 * --------
 * Only in dark, and lazily. The map lives in its own module behind
 * `next/dynamic` so MapLibre's ~270 kB is fetched the first time somebody picks
 * dark rather than by everybody on first load. Switching away unmounts
 * the subtree, which runs MapLibre's own `map.remove()` and releases the WebGL
 * context — the portal does not keep a GPU surface alive for a theme nobody is
 * looking at.
 *
 * The layer fades in on the map's `load` event rather than appearing with it.
 * The `Map` component paints a loader over an unloaded map; behind a UI, a
 * pulsing dot cluster is noise, so the whole layer stays at zero opacity until
 * there is a London to show, and the deep navy under it carries first paint.
 *
 * FAILURE
 * -------
 * MapLibre throws when WebGL is unavailable — a headless browser, a blocklisted
 * driver, a locked-down device — and a dynamic import can fail on a flaky
 * connection. Either would otherwise take the portal down, so the boundary
 * below catches both and renders nothing: the theme degrades to the navy stage
 * it is layered over, and the rest of the app never knows.
 * ------------------------------------------------------------------------- */

import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';

import { useAssistantTheme } from '../../lib/theme';

/* `ssr: false` keeps MapLibre out of the server bundle entirely — it reaches
 * for `window` on import. This is why MapStage is a client component even
 * though it renders almost nothing: `next/dynamic` cannot decline SSR from
 * inside a server component. */
const MapCanvas = dynamic(() => import('./map-canvas').then((m) => m.MapCanvas), {
  ssr: false,
});

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

class MapBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // Worth a line in the console — a background that silently never appears is
    // harder to explain than one that says why.
    console.warn('[assistant] map stage unavailable, falling back to the navy stage', error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function MapStage(): JSX.Element | null {
  const { theme } = useAssistantTheme();
  const [ready, setReady] = useState(false);

  const active = theme === 'dark';

  useEffect(() => {
    // The subtree unmounts on the way out but this component does not, so the
    // fade has to be re-armed or the next visit starts opaque over a blank map.
    if (!active) setReady(false);
  }, [active]);

  const handleReady = useCallback(() => setReady(true), []);

  if (!active) return null;

  return (
    <div className="pa-map-stage" data-ready={ready ? 'true' : 'false'}>
      <MapBoundary>
        <MapCanvas onReady={handleReady} />
      </MapBoundary>
    </div>
  );
}
