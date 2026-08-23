/**
 * Studio — Stage · Rail · Dock, trimmed to the main editing tab.
 *
 * Ported from app/studio (page.tsx + components/*). Structure, copy, spacing
 * and behaviour follow the app; what is deliberately absent is everything the
 * brief excluded — compare views, markup, injection mapping, patient record,
 * analysis overlays and the variation dock — so the rail carries Sculpt alone.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import ModelStage from './ModelStage';
import { ChevronDown, RotateCcw, Redo2, Search, SlidersHorizontal, Undo2 } from './icons';
import {
    activeCount,
    applySlider,
    getSliderValue,
    getVisibleCategories,
    zeroedValues,
    type SliderDef,
} from './sliders';

const PATIENT_NAME = 'Anabella';

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

/* ── FlowSlider ──────────────────────────────────────────────────────────── */

function FlowSlider({
    label,
    value,
    min,
    max,
    step = 1,
    centerOrigin = false,
    modified,
    onChange,
    onReset,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    centerOrigin?: boolean;
    modified?: boolean;
    onChange: (v: number) => void;
    onReset?: () => void;
}) {
    const span = max - min;
    const pct = ((value - min) / span) * 100;
    const zeroPct = ((0 - min) / span) * 100;
    const fillLeft = centerOrigin ? Math.min(pct, zeroPct) : 0;
    const fillWidth = centerOrigin ? Math.abs(pct - zeroPct) : pct;

    return (
        <div className="st-slider-row">
            <div className="st-slider-head">
                <span className="st-slider-name">
                    {modified && <span className="st-slider-dot" aria-hidden />}
                    <span>{label}</span>
                </span>
                <span className="st-slider-right">
                    {modified && onReset && (
                        <button
                            type="button"
                            className="st-reset"
                            onClick={onReset}
                            aria-label={`Reset ${label}`}
                        >
                            reset
                        </button>
                    )}
                    <span className="st-slider-value">{Math.round(value)}</span>
                </span>
            </div>
            <div className="st-track-wrap">
                <div className="st-track">
                    {centerOrigin && <span className="st-track-zero" style={{ left: `${zeroPct}%` }} aria-hidden />}
                    <span
                        className="st-track-fill"
                        style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
                        aria-hidden
                    />
                </div>
                <span className="st-thumb-wrap" style={{ left: `${pct}%` }} aria-hidden>
                    <span className="st-slider-thumb" />
                </span>
                <input
                    className="st-range"
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    aria-label={label}
                    onChange={(e) => onChange(Number(e.target.value))}
                />
            </div>
        </div>
    );
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
    const [sliderValues, setSliderValues] = useState<Record<string, number>>({});
    // Closed on arrival: the subject sits centred in the frame, and the rail
    // lamp pulses until it is opened. Opening slides the stage left, as in the
    // app, rather than the head being drawn off-centre from the start.
    const [panelOpen, setPanelOpen] = useState(false);
    const [, setModelReady] = useState(false);

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

    return (
        <div className="studio-root" data-panel={panelOpen ? 'open' : 'closed'}>
            <div className="st-stage-glow" aria-hidden />
            <ModelStage values={sliderValues} onTargets={onTargets} onReady={onReady} />

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
                        <span className="st-patient-name">{PATIENT_NAME}</span>
                        <span className="st-tag">3D Consult</span>
                    </span>
                </div>

                <div className="st-actions st-glass">
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

            {/* Tool rail — Sculpt is the only tab this build carries. */}
            <div className="st-rail st-glass">
                <button
                    type="button"
                    className="st-rail-btn"
                    data-active="true"
                    onClick={() => setPanelOpen((o) => !o)}
                    aria-label="Sculpt"
                    aria-pressed
                    data-hint={!panelOpen}
                >
                    <span className="st-rail-lamp" aria-hidden>
                        <span>
                            <span />
                        </span>
                    </span>
                    <SlidersHorizontal size={18} strokeWidth={2.2} />
                    <span className="st-rail-tip">
                        {panelOpen ? 'Hide sculpt panel' : 'Show sculpt panel'}
                    </span>
                </button>
            </div>

            {/* The one contextual surface */}
            {panelOpen && (
                <section className="st-toolpanel st-panel" aria-label="Sculpt panel">
                    <div className="st-panel-head">
                        <div className="st-panel-head-left">
                            <span className="st-panel-icon st-inset">
                                <SlidersHorizontal />
                            </span>
                            <div style={{ minWidth: 0 }}>
                                <h2 className="st-panel-title">Sculpt</h2>
                                <p className="st-panel-sub">Morph the anatomy in real time</p>
                            </div>
                        </div>
                    </div>
                    <hr className="st-hairline" />
                    <div className="st-panel-body st-scroll">
                        <SculptPanel
                            sliderValues={sliderValues}
                            availableMorphTargets={availableMorphTargets}
                            onChange={commit}
                        />
                    </div>
                </section>
            )}

            <div className="st-hint">Drag to orbit · scroll to zoom</div>
        </div>
    );
}
