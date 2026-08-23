/**
 * Studio — Stage · Rail · Dock, trimmed to the tools this demo carries.
 *
 * Ported from app/studio (page.tsx + components/*). Structure, copy, spacing
 * and behaviour follow the app; what is deliberately absent is everything the
 * brief excluded — drawing and measurement, injection mapping, patient record,
 * analysis overlays and the variation dock — so the rail carries Sculpt and
 * Lighting, and the view switcher carries the three compare modes.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ModelStage, { createSharedCamera } from './ModelStage';
import LightingPanel from './LightingPanel';
import { FlowSlider } from './bits';
import {
    ChevronDown,
    Columns2,
    Maximize2,
    RotateCcw,
    Redo2,
    Search,
    SlidersHorizontal,
    SquareSplitHorizontal,
    Sun,
    Undo2,
} from './icons';
import { DEFAULT_LIGHT, type LightSettings } from './lighting';
import {
    activeCount,
    applySlider,
    getSliderValue,
    getVisibleCategories,
    SEED_SLIDERS,
    zeroedValues,
    type SliderDef,
} from './sliders';

/** Panel width plus its right offset — what it takes out of the stage. */
const PANEL_SPAN = 352 + 76;

type StudioView = 'single' | 'split' | 'reveal';
type StudioTool = 'sculpt' | 'lighting';

const VIEWS: { id: StudioView; label: string; Icon: React.FC<{ size?: number }> }[] = [
    { id: 'single', label: 'Single', Icon: Maximize2 },
    { id: 'split', label: 'Split', Icon: Columns2 },
    { id: 'reveal', label: 'Reveal', Icon: SquareSplitHorizontal },
];

const TOOLS: { id: StudioTool; label: string; title: string; subtitle: string; Icon: React.FC<{ size?: number; strokeWidth?: number }> }[] = [
    { id: 'sculpt', label: 'Sculpt', title: 'Sculpt', subtitle: 'Morph the anatomy in real time', Icon: SlidersHorizontal },
    { id: 'lighting', label: 'Lighting', title: 'Lighting', subtitle: 'Light, lens & render mode', Icon: Sun },
];

/* ── Collapsible ─────────────────────────────────────────────────────────── */

function Collapsible({
    title,
    badge,
    defaultOpen = false,
    children,
}: {
    title: string;
    badge?: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="st-collapse">
            <button type="button" className="st-collapse-btn" onClick={() => setOpen((o) => !o)}>
                <span className="st-collapse-label">
                    <span className="st-collapse-title">{title}</span>
                    {badge}
                </span>
                <span className="st-chevron" data-open={open}>
                    <ChevronDown size={14} />
                </span>
            </button>
            {open && <div className="st-collapse-body">{children}</div>}
        </div>
    );
}

function CountBadge({ count }: { count: number }) {
    if (count <= 0) return null;
    return <span className="st-count">{count}</span>;
}

/* ── SculptPanel ─────────────────────────────────────────────────────────── */

function SculptPanel({
    sliderValues,
    availableMorphTargets,
    onChange,
}: {
    sliderValues: Record<string, number>;
    availableMorphTargets: string[];
    onChange: (values: Record<string, number>) => void;
}) {
    const [query, setQuery] = useState('');

    const categories = useMemo(
        () => getVisibleCategories(availableMorphTargets),
        [availableMorphTargets],
    );
    const totalControls = useMemo(
        () => categories.reduce((n, c) => n + c.sliders.length, 0),
        [categories],
    );
    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        const out: SliderDef[] = [];
        for (const cat of categories) {
            for (const s of cat.sliders) {
                if (s.label.toLowerCase().includes(q)) out.push(s);
            }
        }
        return out;
    }, [query, categories]);

    const setSlider = (slider: SliderDef, value: number) =>
        onChange(applySlider(sliderValues, slider, value, availableMorphTargets));

    const renderSlider = (slider: SliderDef) => {
        const value = getSliderValue(slider, sliderValues, availableMorphTargets);
        const modified = Math.round(value) !== 0;
        return (
            <FlowSlider
                key={slider.label}
                label={slider.label}
                value={value}
                min={-100}
                max={100}
                centerOrigin
                modified={modified}
                onChange={(v) => setSlider(slider, v)}
                onReset={() => setSlider(slider, 0)}
            />
        );
    };

    return (
        <div>
            <div className="st-search">
                <span className="st-search-icon">
                    <Search size={14} />
                </span>
                <input
                    className="st-input"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${totalControls} controls…`}
                    aria-label="Search sculpt controls"
                />
            </div>

            {matches ? (
                <div className="st-matches st-sliders">
                    {matches.length === 0 ? (
                        <p className="st-empty">No controls match “{query}”.</p>
                    ) : (
                        matches.map(renderSlider)
                    )}
                </div>
            ) : (
                <div>
                    {categories.map((cat, i) => (
                        <Collapsible
                            key={cat.name}
                            title={cat.name}
                            defaultOpen={i === 0}
                            badge={<CountBadge count={activeCount(cat, sliderValues, availableMorphTargets)} />}
                        >
                            <div className="st-sliders">{cat.sliders.map(renderSlider)}</div>
                        </Collapsible>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── Studio ──────────────────────────────────────────────────────────────── */

export default function Studio() {
    const [availableMorphTargets, setAvailableMorphTargets] = useState<string[]>([]);
    // The head arrives sculpted; the Original in compare views stays unedited.
    const [sliderValues, setSliderValues] = useState<Record<string, number>>(SEED_SLIDERS);
    const [light, setLight] = useState<LightSettings>(DEFAULT_LIGHT);
    const [tool, setTool] = useState<StudioTool>('sculpt');
    const [panelOpen, setPanelOpen] = useState(false);
    const [view, setView] = useState<StudioView>('single');
    const [, setModelReady] = useState(false);

    // Both stages orbit as one — whichever is dragged publishes the pose here.
    const shared = useRef(createSharedCamera()).current;

    // The Original mounts on the FIRST compare view and then stays mounted
    // (hidden in single view) — single-only sessions never pay for it.
    const [everCompared, setEverCompared] = useState(false);
    useEffect(() => {
        if (view !== 'single') setEverCompared(true);
    }, [view]);

    // Undo/redo over slider snapshots, as in the app's useUndoRedo.
    const past = useRef<Record<string, number>[]>([]);
    const future = useRef<Record<string, number>[]>([]);
    const [historyTick, setHistoryTick] = useState(0);

    const commit = useCallback((next: Record<string, number>) => {
        setSliderValues((prev) => {
            past.current.push(prev);
            if (past.current.length > 100) past.current.shift();
            future.current = [];
            return next;
        });
        setHistoryTick((t) => t + 1);
    }, []);

    const undo = useCallback(() => {
        setSliderValues((prev) => {
            const previous = past.current.pop();
            if (previous === undefined) return prev;
            future.current.push(prev);
            return previous;
        });
        setHistoryTick((t) => t + 1);
    }, []);

    const redo = useCallback(() => {
        setSliderValues((prev) => {
            const next = future.current.pop();
            if (next === undefined) return prev;
            past.current.push(prev);
            return next;
        });
        setHistoryTick((t) => t + 1);
    }, []);

    const canUndo = past.current.length > 0;
    const canRedo = future.current.length > 0;
    void historyTick; // re-render hook for the refs above

    const onTargets = useCallback((names: string[]) => setAvailableMorphTargets(names), []);
    const onReady = useCallback(() => setModelReady(true), []);

    /* ── view switcher pill ───────────────────────────────────────────────── */
    const tabRefs = useRef<Record<StudioView, HTMLButtonElement | null>>({
        single: null,
        split: null,
        reveal: null,
    });
    const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
    useLayoutEffect(() => {
        const el = tabRefs.current[view];
        if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    }, [view]);

    /* ── reveal wipe ──────────────────────────────────────────────────────── */
    const [wipe, setWipe] = useState(50);
    const stageWrapRef = useRef<HTMLDivElement>(null);
    const draggingWipe = useRef(false);

    const wipeFromClientX = useCallback((clientX: number) => {
        const rect = stageWrapRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        setWipe(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
    }, []);

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (!draggingWipe.current) return;
            e.preventDefault();
            wipeFromClientX(e.clientX);
        };
        const onUp = () => {
            draggingWipe.current = false;
        };
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [wipeFromClientX]);

    /* ── per-view geometry (CSS only — the viewers never remount) ──────────── */
    // `right`/`left` are spelled out because .st-stage sets inset: 0 — leaving
    // one side to the class over-constrains the box and the half lands at 0.
    const originalStyle: React.CSSProperties =
        view === 'split'
            ? { position: 'absolute', top: 0, bottom: 0, left: 0, right: 'auto', width: '50%' }
            : view === 'reveal'
              ? { position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - wipe}% 0 0)` }
              : { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' };

    const primaryStyle: React.CSSProperties =
        view === 'split'
            ? { position: 'absolute', top: 0, bottom: 0, right: 0, left: 'auto', width: '50%' }
            : view === 'reveal'
              ? { position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${wipe}%)` }
              : { position: 'absolute', inset: 0 };

    const activeTool = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];

    return (
        <div className="studio-root" data-panel={panelOpen ? 'open' : 'closed'} data-view={view}>
            <div className="st-stage-glow" aria-hidden />

            {/*
             * Single view slides out from under the panel (see the stylesheet).
             * The compare views can't: sliding far enough to clear the panel
             * would carry the left half off the edge in a box this size, so
             * they give the panel its width back instead and lay both halves
             * out in what remains.
             */}
            <div
                className="st-stagewrap"
                ref={stageWrapRef}
                style={view !== 'single' && panelOpen ? { right: PANEL_SPAN } : undefined}
            >
                {everCompared && (
                    <ModelStage
                        values={{}}
                        light={light}
                        shared={shared}
                        className="st-stage"
                        style={originalStyle}
                    />
                )}
                <ModelStage
                    values={sliderValues}
                    light={light}
                    shared={shared}
                    onTargets={onTargets}
                    onReady={onReady}
                    className="st-stage"
                    style={primaryStyle}
                />

                {view === 'split' && <span className="st-split-line" aria-hidden />}
                {view === 'reveal' && (
                    <>
                        <span className="st-wipe-line" style={{ left: `${wipe}%` }} aria-hidden />
                        <button
                            type="button"
                            className="st-wipe-handle"
                            style={{ left: `${wipe}%` }}
                            aria-label="Reveal position"
                            role="slider"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(wipe)}
                            onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                                draggingWipe.current = true;
                                wipeFromClientX(e.clientX);
                            }}
                        >
                            <SquareSplitHorizontal size={13} />
                        </button>
                    </>
                )}
                {view !== 'single' && (
                    <>
                        <span className="st-compare-tag" data-side="left">
                            Original
                        </span>
                        <span className="st-compare-tag" data-side="right">
                            Edited
                        </span>
                    </>
                )}
            </div>

            {/* Top chrome */}
            <div className="st-topbar">
                <div className="st-identity st-glass">
                    <span className="st-brand">
                        Sculptr <span>Studio</span>
                    </span>
                    <span className="st-divider" aria-hidden />
                    <span className="st-patient">
                        <span className="st-ping" aria-hidden>
                            <span />
                            <span />
                        </span>
                        <span className="st-tag">3D Consult</span>
                    </span>
                </div>

                <div className="st-actions st-glass">
                    <div className="st-tabs" role="tablist" aria-label="View mode">
                        {/* Sliding active pill (compositor transform — glides even
                            while the view switch reflows the canvases). */}
                        <span
                            aria-hidden
                            className="st-tab-pill"
                            style={{
                                width: pill?.width ?? 0,
                                transform: `translateX(${pill?.left ?? 0}px)`,
                                opacity: pill ? 1 : 0,
                            }}
                        />
                        {VIEWS.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                ref={(el) => {
                                    tabRefs.current[id] = el;
                                }}
                                type="button"
                                role="tab"
                                aria-selected={view === id}
                                data-active={view === id}
                                className="st-tab"
                                onClick={() => setView(id)}
                                title={label}
                            >
                                <Icon size={14} />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>

                    <span className="st-divider" aria-hidden />

                    <button
                        type="button"
                        className="st-icon-btn"
                        onClick={undo}
                        disabled={!canUndo}
                        aria-label="Undo"
                        title="Undo"
                    >
                        <Undo2 />
                    </button>
                    <button
                        type="button"
                        className="st-icon-btn"
                        onClick={redo}
                        disabled={!canRedo}
                        aria-label="Redo"
                        title="Redo"
                    >
                        <Redo2 />
                    </button>
                    <button
                        type="button"
                        className="st-icon-btn"
                        onClick={() => commit(zeroedValues(sliderValues))}
                        aria-label="Reset all sliders"
                        title="Reset all sliders"
                    >
                        <RotateCcw />
                    </button>
                </div>
            </div>

            {/* Tool rail — clicking the active tool collapses the panel, as in the app. */}
            <div className="st-rail st-glass">
                {TOOLS.map(({ id, label, Icon }) => {
                    const active = tool === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            className="st-rail-btn"
                            data-active={active}
                            data-hint={!panelOpen && id === 'sculpt'}
                            aria-label={label}
                            aria-pressed={active}
                            onClick={() => {
                                if (active) setPanelOpen((o) => !o);
                                else {
                                    setTool(id);
                                    setPanelOpen(true);
                                }
                            }}
                        >
                            {active && (
                                <span className="st-rail-lamp" aria-hidden>
                                    <span>
                                        <span />
                                    </span>
                                </span>
                            )}
                            <Icon size={18} strokeWidth={2.2} />
                            <span className="st-rail-tip">
                                {active ? (panelOpen ? `Hide ${label.toLowerCase()} panel` : `Show ${label.toLowerCase()} panel`) : label}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* The contextual surface */}
            {panelOpen && (
                <section className="st-toolpanel st-panel" aria-label={`${activeTool.title} panel`}>
                    <div className="st-panel-head">
                        <div className="st-panel-head-left">
                            <span className="st-panel-icon st-inset">
                                <activeTool.Icon />
                            </span>
                            <div style={{ minWidth: 0 }}>
                                <h2 className="st-panel-title">{activeTool.title}</h2>
                                <p className="st-panel-sub">{activeTool.subtitle}</p>
                            </div>
                        </div>
                    </div>
                    <hr className="st-hairline" />
                    <div className="st-panel-body st-scroll">
                        {tool === 'sculpt' ? (
                            <SculptPanel
                                sliderValues={sliderValues}
                                availableMorphTargets={availableMorphTargets}
                                onChange={commit}
                            />
                        ) : (
                            <LightingPanel light={light} onChange={setLight} />
                        )}
                    </div>
                </section>
            )}

            <div className="st-hint">Drag to orbit · scroll to zoom</div>
        </div>
    );
}
