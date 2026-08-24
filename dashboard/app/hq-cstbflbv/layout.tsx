/* ---------------------------------------------------------------------------
 * /assistant — layout.
 *
 * The root layout already supplies <html>, <body>, the fonts, the providers and
 * the paper stage (white ground, azure top-glow, navy dot-grid, film grain), so
 * this layer does three things: pull in the portal's own design kit, resolve the
 * light/dark choice BEFORE first paint, and keep the surface out of every index.
 *
 * SERVER component on purpose — nothing here needs the browser.
 * ------------------------------------------------------------------------- */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './assistant.css';

export const metadata: Metadata = {
  /* The browser tab. The root layout's title is a plain string rather than a
     template, so this replaces it outright — no "Home | Sculptr". */
  title: 'Home',
  description: 'Personal goal system — vision to daily action',
  robots: { index: false, follow: false },
};

/* ---------------------------------------------------------------------------
 * The blocking theme script
 *
 * Stamps `data-pa-theme` (and, in dark, `data-pa-stage`) on <html> before the
 * browser paints, which is the only way to avoid a flash of the light theme: a
 * React effect necessarily runs after the first paint, and assistant.css keys
 * every dark token off that attribute.
 *
 * Dark writes `data-pa-theme='dark'` plus `data-pa-stage='map'` — the dark ink
 * family standing on the London map. See lib/theme.ts for why the two are
 * separate attributes, and why a stored `'map'` reads as `'dark'` here.
 *
 * ── Why the source is duplicated here ──────────────────────────────────────
 * `lib/theme.ts` exports the identical string as THEME_INIT_SCRIPT, but that
 * module is `'use client'`. A server component that imports from a client module
 * does not receive the value — Next replaces the module with a proxy of client
 * references, and dotting into one on the server throws. So the string is
 * inlined verbatim instead of imported.
 *
 * KEEP IN SYNC with lib/theme.ts: THEME_STORAGE_KEY ('assistant.theme.v1'), the
 * `(prefers-color-scheme: dark)` query, the accepted values, and both attribute
 * names. The two only
 * ever write the same value, so a drift shows up as a one-frame flash rather
 * than a wrong theme — but fix it at the source if you touch either.
 *
 * Self-contained, double-wrapped in try/catch (Safari throws on localStorage in
 * some privacy modes) and free of any `</script>` sequence, so it is safe to
 * inline as-is.
 * ------------------------------------------------------------------------- */
const THEME_INIT_SCRIPT =
  `(function(){try{var s=null;try{s=window.localStorage.getItem("assistant.theme.v1");}catch(e){}` +
  `if(s==='map'){s='dark';}` +
  `var t=(s==='dark'||s==='light')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');` +
  `var d=document.documentElement;d.setAttribute('data-pa-theme',t);` +
  `if(t==='dark'){d.setAttribute('data-pa-stage','map');}else{d.removeAttribute('data-pa-stage');}}catch(e){}})();`;

/* ---------------------------------------------------------------------------
 * The blocking dimmer script
 *
 * Same deal as the theme one above, and duplicated here for the same reason —
 * `lib/brightness.ts` is `'use client'` and a server component that imports
 * from one gets a proxy of client references rather than the value.
 *
 * It matters more here than it does for the theme. This is a control you reach
 * for at night; a React effect necessarily runs after the first paint, so
 * without this the portal would flash at full brightness every time you opened
 * it — which is exactly the thing you turned it down to avoid.
 *
 * The scale runs 20–200 with 100 meaning untouched: below it a black sheet at
 * `(100 - n) / 100 × 0.85`, above it a gamma sheet whose STRENGTH is
 * `(n - 100) / 100`. The null and empty cases are handled before the
 * arithmetic on purpose — `Number(null)` is 0, not NaN, so `isFinite` never
 * caught it and a first visit used to paint at the darkest end of the range
 * until React hydrated.
 *
 * KEEP IN SYNC with lib/brightness.ts: the storage key
 * ('assistant.brightness.v1'), the 20/100/200 bounds, the 0.85 dim ceiling,
 * and both the `data-pa-dim` and `data-pa-lift` attributes the stylesheet keys
 * off. A drift shows up as one frame at the wrong brightness rather than a
 * wrong setting.
 * ------------------------------------------------------------------------- */
const BRIGHTNESS_INIT_SCRIPT =
  `(function(){try{var v=null;try{v=window.localStorage.getItem("assistant.brightness.v1");}catch(e){}` +
  `var n=(v===null||v==='')?100:Math.min(200,Math.max(20,Math.round(Number(v))));if(!isFinite(n)){n=100;}` +
  `var r=document.documentElement;` +
  `if(n<100){r.setAttribute('data-pa-dim','on');r.style.setProperty('--pa-dim',(((100-n)/100)*0.85).toFixed(3));}` +
  `else if(n>100){r.setAttribute('data-pa-lift','on');r.style.setProperty('--pa-lift',(n/100).toFixed(3));}}catch(e){}})();`;

/* ---------------------------------------------------------------------------
 * The brightness curve
 *
 * The only tone curve CSS can reach. Every shorthand filter function —
 * `brightness`, `contrast`, `saturate`, `invert` — is affine in the colour
 * channels, so all of them are straight lines and all of them clip. This
 * portal's dark text sits at 0.91 luminance, which means a multiply of much
 * over 1.1 drives it into flat white and takes its antialiasing with it: at 2×
 * a third of the pixels in a heading were pure white and the block had lost a
 * quarter of its distinct tone levels.
 *
 * `feComponentTransfer` bends it instead. An exponent below 1 lifts the
 * shadows and mid-tones hard while leaving 0 at 0 and 1 at 1, so nothing can
 * clip however far the slider goes. 0.7 measures ×1.98 mean luminance on the
 * dark theme — the same lift the multiply gave — with nothing clipped and 207
 * of the original 224 levels intact.
 *
 * `sRGB` and not the SVG default of `linearRGB`: the curve is meant to act on
 * the encoded values, which is the "brighten" every image editor means.
 *
 * Rendered here, in the layout, rather than from a component — it has to exist
 * for the very first paint, which is the whole point of the blocking script
 * above. Hidden by size and position rather than `display: none`, which can
 * take referenced filters with it.
 * ------------------------------------------------------------------------- */
function BrightnessFilter(): JSX.Element {
  return (
    <svg
      aria-hidden
      focusable="false"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <filter
        id="pa-lift-curve"
        colorInterpolationFilters="sRGB"
        x="0%"
        y="0%"
        width="100%"
        height="100%"
      >
        <feComponentTransfer>
          <feFuncR type="gamma" exponent="0.7" />
          <feFuncG type="gamma" exponent="0.7" />
          <feFuncB type="gamma" exponent="0.7" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: BRIGHTNESS_INIT_SCRIPT }} />
      <BrightnessFilter />
      {children}
    </>
  );
}
