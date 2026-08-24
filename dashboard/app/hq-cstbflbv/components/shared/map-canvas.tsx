'use client';

/* ---------------------------------------------------------------------------
 * MapCanvas — the London map itself, and the only thing that pulls MapLibre in.
 *
 * Split out from MapStage so it can be `next/dynamic`'d: MapLibre and its CSS
 * are ~270 kB, which is most of a megabyte of parse for a theme two thirds of
 * people will never turn on. Kept in its own module, that weight downloads the
 * first time somebody picks dark and never before.
 *
 * Nothing here decides anything — MapStage owns the theme gate, the fade and
 * the failure boundary. This module renders a map and says when it is ready.
 * ------------------------------------------------------------------------- */

import { useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { Map } from '@/components/ui/mapcn-marker-label';

/** Charing Cross, near enough — the point London measures itself from. */
const LONDON: [number, number] = [-0.1276, 51.5072];

/** The framing this started from: the whole of inner London, river to river. */
const BASE_ZOOM = 11.4;

/** How much closer than that, as a plain scale factor: 20%, 20%, 10%, 10%. */
const SCALE = 1.2 * 1.2 * 1.1 * 1.1;

/**
 * Close enough to read the river and the parks, far enough to stay quiet.
 *
 * Written as a base plus a SCALE rather than as the number it comes to (11.93),
 * because web-map zoom is logarithmic — every whole level doubles the scale — so
 * "20% closer" is `+log2(1.2)` ≈ 0.26 of a level, not 20% added to the number.
 * Multiplying the zoom itself by 1.2 would magnify London about five times.
 * Keeping the factor separate means the next "20% closer" is one more `* 1.2`
 * here and nothing else.
 */
const ZOOM = BASE_ZOOM + Math.log2(SCALE);

/** A little off north, so the grid of streets is not a grid of pixels. */
const BEARING = -12;

export interface MapCanvasProps {
  /** Called once the first frame is on screen. */
  onReady: () => void;
}

export function MapCanvas({ onReady }: MapCanvasProps): JSX.Element {
  /* The `Map` forwards its MapLibre instance. It arrives before the tiles do —
   * the imperative handle is a layout effect and the map is built in a passive
   * one — so the first call can hand back null, and the one after it a map that
   * has not loaded yet. Both are expected. */
  const handleMap = useCallback(
    (map: MapLibreMap | null) => {
      if (!map) return;
      if (map.loaded()) {
        onReady();
        return;
      }
      map.once('load', onReady);
    },
    [onReady],
  );

  return (
    <Map
      ref={handleMap}
      theme="dark"
      center={LONDON}
      zoom={ZOOM}
      bearing={BEARING}
      interactive={false}
    />
  );
}
