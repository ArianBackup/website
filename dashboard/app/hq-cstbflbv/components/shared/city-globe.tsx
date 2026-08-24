'use client';

/* ---------------------------------------------------------------------------
 * CityGlobe — the globe in the top-right corner.
 *
 * Four cities lit up on a slowly turning globe, with an arc from London to San
 * Francisco. It sits on the stage rather than in a panel: fixed to the corner
 * of the viewport, in the gutter beside the column of panels.
 *
 * HOW A CITY IS MARKED
 * --------------------
 * Not with a pin sitting on top of the map — with the map's own dots, in a
 * different colour. `markerSize` is set close to the size of the sampled dots
 * and `markerElevation` to zero, so a marked city reads as part of the same
 * dot grid rather than as something stuck to the front of it.
 *
 * THE GLOW, AND WHY IT IS NOT IN THE CANVAS
 * -----------------------------------------
 * cobe draws a marker as a hard flat disc. Measured across one at 3x: the
 * background sits at 13, the next pixel is 161, it holds 161 flat across the
 * whole width, and one pixel later it is back at 13. There is no falloff to
 * work with, so no combination of colour, size or brightness will make that
 * disc glow — the first attempt pulsed both and it only ever read as a dot
 * changing size.
 *
 * So the disc stays as the crisp point, and the halo is a CSS layer over the
 * top: one radial gradient per city, anchored to the tracker element cobe
 * already emits for each marker, breathing on a `@keyframes` cycle. It is
 * composited rather than redrawn, it costs nothing per frame, and being CSS it
 * eases smoothly by construction.
 *
 * That layer needs CSS Anchor Positioning, which only Chromium ships, so it is
 * behind an `@supports` guard: everywhere else the crisp dot renders on its own
 * and nothing is broken or misplaced. The visibility of each halo rides on
 * `--cobe-visible-<id>`, the custom property cobe sets while a marker faces the
 * camera, so a halo cannot hang over the back of the globe.
 *
 * The kit's own label layer is hidden for the same anchor-positioning reason —
 * see `.pa-globe-orb` in assistant.css.
 * ------------------------------------------------------------------------- */

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { useReducedMotion } from 'motion/react';

import { Globe } from '@/components/ui/cobe-globe';

import { useAssistantTheme } from '../../lib/theme';

interface City {
  id: string;
  label: string;
  /** cobe takes [latitude, longitude], in that order. */
  location: [number, number];
}

const CITIES: City[] = [
  { id: 'tehran', label: 'Tehran', location: [35.6892, 51.389] },
  { id: 'london', label: 'London', location: [51.5074, -0.1278] },
  { id: 'newyork', label: 'New York', location: [40.7128, -74.006] },
  { id: 'sanfrancisco', label: 'San Francisco', location: [37.7749, -122.4194] },
];

/* Module-level so the reference never changes: the `Globe` rebuilds its WebGL
 * context whenever `markers` or `arcs` change identity. */
const MARKERS = CITIES.map((city) => ({
  id: city.id,
  location: city.location,
  label: city.label,
}));

const ARCS = [
  {
    id: 'london-sanfrancisco',
    from: [51.5074, -0.1278] as [number, number],
    to: [37.7749, -122.4194] as [number, number],
  },
];

/** cobe wants linear 0–1 RGB, so the brand hexes are written out by hand. */
interface Palette {
  baseColor: [number, number, number];
  markerColor: [number, number, number];
  arcColor: [number, number, number];
  glowColor: [number, number, number];
  dark: number;
  mapBrightness: number;
}

/* White, and the kit's own warm halo. A tinted sphere was the previous cut and
 * it read as a colour rather than as a globe — on the near-white stage the
 * shading and the rim are what give it its form, and they only do that when the
 * base is neutral. */
const LIGHT: Palette = {
  baseColor: [1, 1, 1],
  /* Chosen so the beat lands just under 1.0 rather than through it: at the
   * peak gain of 2.15 this reaches [0.09, 0.39, 0.97]. A brighter base clamps
   * on blue a quarter of the way into the swell, and from there the pulse stops
   * being a change in brightness and becomes a change in hue. */
  markerColor: [0.04, 0.18, 0.45], // deep navy-blue  #0b2e73
  /* The line is meant to be white, and in the dark themes it is. It cannot be
   * here: the sphere is white, so a white arc over the lit face of it is not a
   * subtle line, it is no line at all. This is the same idea in the only value
   * that survives the background — neutral, uncoloured, and visible. */
  arcColor: [0.16, 0.18, 0.24],
  glowColor: [0.94, 0.93, 0.91],
  dark: 0,
  mapBrightness: 5,
};

/* Dark mode, which is the ink family standing on the London map. */
const DARK: Palette = {
  baseColor: [0.36, 0.45, 0.66],
  markerColor: [0.05, 0.24, 0.45], // deep navy-blue  #0d3d73 — see LIGHT
  arcColor: [1, 1, 1],
  glowColor: [0.09, 0.15, 0.29],
  dark: 1,
  mapBrightness: 7.5,
};

/** Dense enough that a city's dots belong to the same grid as the coastlines. */
const MAP_SAMPLES = 22000;

export interface CityGlobeProps {
  className?: string;
}

export function CityGlobe({ className }: CityGlobeProps): JSX.Element | null {
  const { theme, ready } = useAssistantTheme();
  const reduce = useReducedMotion();

  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1440px)');
    const sync = (): void => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const palette = theme === 'light' ? LIGHT : DARK;

  /* `.pa-globe` is `display: none` below 1440px, but CSS does not stop React
   * mounting the thing — every phone was still loading cobe, creating a WebGL
   * context, uploading a 22k-sample map texture at 3× and running a
   * requestAnimationFrame spin loop into a zero-sized invisible canvas. The
   * same 1440px the stylesheet uses, so the two cannot disagree. */

  /* Held back until the stored theme has been read. The globe is rebuilt from
   * scratch whenever the palette changes, so painting the light one first and
   * correcting it a frame later would cost a full teardown for nothing. */
  if (!ready || !wide) return null;

  return (
    <aside
      className={clsx('pa-globe', className)}
      aria-label={`Globe marking ${CITIES.map((city) => city.label).join(', ')}`}
    >
      <Globe
        className="pa-globe-orb"
        markers={MARKERS}
        arcs={ARCS}
        baseColor={palette.baseColor}
        markerColor={palette.markerColor}
        arcColor={palette.arcColor}
        glowColor={palette.glowColor}
        dark={palette.dark}
        mapBrightness={palette.mapBrightness}
        mapSamples={MAP_SAMPLES}
        // Seated flush with the map — no elevation — and small: this is the
        // crisp point at the centre of the halo, not the glow itself.
        markerSize={0.026}
        markerElevation={0}
        // 3x rather than the kit's 2x ceiling. The orb is small and the markers
        // are smaller, and this is the whole of their edge quality.
        maxDevicePixelRatio={3}
        arcWidth={0.45}
        arcHeight={0.32}
        diffuse={1.25}
        theta={0.28}
        speed={reduce ? 0 : 0.0022}
      />

      {/* The halo layer. Inert, and absent outside Chromium — see the note at
          the top of this file. The outer span carries the anchor and the
          facing-the-camera fade; the inner one does the breathing, so the two
          opacities multiply instead of fighting over the same property. */}
      {CITIES.map((city) => (
        <span
          key={city.id}
          aria-hidden
          className="pa-globe-halo"
          style={{
            positionAnchor: `--cobe-${city.id}`,
            opacity: `var(--cobe-visible-${city.id}, 0)`,
          }}
        >
          <span />
        </span>
      ))}
    </aside>
  );
}
