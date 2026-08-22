/**
 * The Sculptr demo that plays inside the AriTube window on the desktop:
 * the model-generation loader runs first, then hands off to the Studio.
 *
 * The loader is the app's own — SculptLoader driven by useSyntheticProgress,
 * the same controller the real capture flow uses. There, `complete` flips when
 * the reconstruction lands; here it flips on a timer, which drives the identical
 * snap-to-100 + finale before the studio fades in.
 */
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { LoadingScreen } from './LoadingScreen';
import { useSyntheticProgress } from './useSyntheticProgress';
import Studio from './Studio';
import './styles.css';

/**
 * The app's chrome is sized for a full screen; the AriTube player is a fraction
 * of that. Rendering at a fixed design height and scaling to fit keeps the
 * proportions the app was drawn at (panel width against stage, type against
 * chrome) instead of letting a 352px panel swallow a 747px box. Width follows
 * the host's aspect so nothing is letterboxed.
 */
const DESIGN_HEIGHT = 620;

function ScaleToFit({ children }: { children: React.ReactNode }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState<{ w: number; h: number } | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const measure = () =>
            setBox({ w: Math.max(host.clientWidth, 1), h: Math.max(host.clientHeight, 1) });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(host);
        return () => ro.disconnect();
    }, []);

    const scale = box ? box.h / DESIGN_HEIGHT : 1;
    const width = box ? box.w / scale : DESIGN_HEIGHT * 2;

    return (
        <div ref={hostRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            {box && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width,
                        height: DESIGN_HEIGHT,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                    }}
                >
                    {children}
                </div>
            )}
        </div>
    );
}

/** How long the generation runs before the model is "ready". */
const BUILD_MS = 7000;
/** Time for the 100% snap + finale to play before the studio takes over. */
const HANDOFF_MS = 1400;

function App() {
    const [complete, setComplete] = useState(false);
    const [showStudio, setShowStudio] = useState(false);

    const { progress, activeStep, statusLine } = useSyntheticProgress({
        complete,
        // The real pipeline takes minutes; this one is a demo, so the curve is
        // tightened to reach a believable ~85% over BUILD_MS rather than creep.
        cap: 92,
        tau: 4.2,
        creepPerSec: 0.9,
    });

    useEffect(() => {
        const build = window.setTimeout(() => setComplete(true), BUILD_MS);
        return () => window.clearTimeout(build);
    }, []);

    useEffect(() => {
        if (!complete) return;
        const handoff = window.setTimeout(() => setShowStudio(true), HANDOFF_MS);
        return () => window.clearTimeout(handoff);
    }, [complete]);

    return (
        <ScaleToFit>
            {showStudio ? (
                <Studio />
            ) : (
                <LoadingScreen
                    progress={progress}
                    activeStep={activeStep}
                    statusLine={statusLine}
                    complete={complete}
                />
            )}
        </ScaleToFit>
    );
}

ReactDOM.render(<App />, document.getElementById('root'));
