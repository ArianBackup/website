/* ---------------------------------------------------------------------------
 * /assistant — the page.
 *
 * All this does is open the scoped stage and mount the client app. Two classes
 * are load-bearing:
 *
 *   .assistant-shell  every `.pa-*` class in assistant.css is scoped under it,
 *                     so without it the whole portal renders unstyled.
 *   .pa-stage         marks THIS shell as the page-level one. The dark theme
 *                     paints its deep-navy ground and dot grid from `.pa-stage`
 *                     only — a shell rendered inside a dialog portal must not
 *                     repaint the viewport behind the dialog. The map stage
 *                     under dark hangs its scrim off the same class.
 *
 * `force-dynamic` keeps the route out of the static prerender — the document
 * lives in the browser, so there is nothing worth baking at build time.
 * ------------------------------------------------------------------------- */

import { AssistantApp } from './components/assistant-app';
import { MapStage } from './components/shared/map-stage';
import { CityGlobe } from './components/shared/city-globe';

export const dynamic = 'force-dynamic';

export default function AssistantPage() {
  return (
    <div className="assistant-shell pa-stage">
      <div className="pa-glow" aria-hidden />
      <AssistantApp />
      {/* Last in the DOM, first in the paint order: the layer is fixed at a
          negative z-index, so where it sits in the document does not affect
          what covers it — but it does put the map's attribution links at the
          end of the tab order rather than ahead of the whole portal. Renders
          nothing in the light theme. */}
      <MapStage />

      {/* Stage furniture, in the gutter beside the panels. Renders nothing
          until the viewport is wide enough to hold it — see `.pa-globe`. */}
      <CityGlobe />
    </div>
  );
}
