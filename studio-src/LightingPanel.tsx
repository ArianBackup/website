/**
 * Lighting — environment, not sculpting. Presets, a draggable sun pad,
 * brightness/perspective, plus flat (all-angles) and clay render modes.
 * Intensity is passed straight through to the renderer (no /100).
 *
 * Ported from app/studio/components/panels/LightingPanel.tsx.
 */
import React, { useCallback, useRef, useState } from 'react';
import { FlowSlider, Toggle } from './bits';
import { LIGHT_PRESETS, type LightSettings } from './lighting';

/** Drag-the-sun direction pad: x → azimuth (-180..180), y → elevation (-90..90). */
function LightPad({
    azimuth,
    elevation,
    disabled,
    onChange,
}: {
    azimuth: number;
    elevation: number;
    disabled: boolean;
    onChange: (az: number, el: number) => void;
}) {
    const padRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);

    const apply = useCallback(
        (clientX: number, clientY: number) => {
            const pad = padRef.current;
            if (!pad) return;
            const rect = pad.getBoundingClientRect();
            const r = rect.width / 2;
            let nx = (clientX - (rect.left + r)) / r;
            let ny = (clientY - (rect.top + r)) / r;
            const dist = Math.hypot(nx, ny);
            if (dist > 1) {
                nx /= dist;
                ny /= dist;
            }
            onChange(Math.round(nx * 180), Math.round(-ny * 90));
        },
        [onChange],
    );

    const dotX = (azimuth / 180) * 50;
    const dotY = (-elevation / 90) * 50;

    return (
        <div
            ref={padRef}
            className="st-lightpad"
            data-disabled={disabled}
            style={{
                background: `radial-gradient(circle at ${50 + dotX}% ${50 + dotY}%, rgba(255,255,255,0.95), rgba(228,238,252,0.75) 42%, rgba(206,222,246,0.6))`,
            }}
            onPointerDown={(e) => {
                if (disabled) return;
                setDragging(true);
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                apply(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
                if (dragging && !disabled) apply(e.clientX, e.clientY);
            }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            role="application"
            aria-label="Light direction pad"
        >
            {/* crosshair + ring guides (plain fills — pad lives in a frosted panel) */}
            <span className="st-lightpad-v" aria-hidden />
            <span className="st-lightpad-h" aria-hidden />
            <span className="st-lightpad-ring" aria-hidden />
            <span
                className="st-lightpad-dot"
                style={{ left: `calc(50% + ${dotX}%)`, top: `calc(50% + ${dotY}%)` }}
                aria-hidden
            />
        </div>
    );
}

export default function LightingPanel({
    light,
    onChange,
}: {
    light: LightSettings;
    onChange: (next: LightSettings) => void;
}) {
    const set = (patch: Partial<LightSettings>) => onChange({ ...light, ...patch });

    return (
        <div className="st-lighting">
            <div>
                <p className="st-label">Presets</p>
                <div className="st-preset-grid">
                    {LIGHT_PRESETS.map((p) => {
                        const active = !light.allAngles && light.azimuth === p.az && light.elevation === p.el;
                        return (
                            <button
                                key={p.name}
                                type="button"
                                className="st-pill"
                                data-active={active}
                                onClick={() => set({ azimuth: p.az, elevation: p.el, allAngles: false })}
                            >
                                {p.name}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div>
                <div className="st-lighting-head">
                    <p className="st-label">Direction</p>
                    <span className="st-readout">
                        {Math.round(light.azimuth)}° / {Math.round(light.elevation)}°
                    </span>
                </div>
                <LightPad
                    azimuth={light.azimuth}
                    elevation={light.elevation}
                    disabled={!!light.allAngles}
                    onChange={(az, el) => set({ azimuth: az, elevation: el })}
                />
            </div>

            <div className="st-sliders">
                <FlowSlider
                    label="Brightness"
                    value={Math.round(light.intensity * 100)}
                    min={0}
                    max={1000}
                    step={5}
                    suffix="%"
                    onChange={(v) => set({ intensity: v / 100 })}
                />
                <FlowSlider
                    label="Perspective"
                    value={light.fov ?? 22}
                    min={20}
                    max={54}
                    step={1}
                    suffix="°"
                    onChange={(v) => set({ fov: v })}
                />
                <div className="st-lens-legend">
                    <span>Flat lens</span>
                    <span>Wide lens</span>
                </div>
            </div>

            <hr className="st-hairline" />

            <div className="st-modes">
                <div className="st-mode-row">
                    <div>
                        <p className="st-mode-title">All angles</p>
                        <p className="st-mode-sub">Even, shadowless light from every side</p>
                    </div>
                    <Toggle
                        checked={!!light.allAngles}
                        onChange={(v) => set({ allAngles: v })}
                        label="All angles"
                    />
                </div>
                <div className="st-mode-row">
                    <div>
                        <p className="st-mode-title">Clay</p>
                        <p className="st-mode-sub">Matte study material — pure form, no texture</p>
                    </div>
                    <Toggle
                        checked={!!light.wireframe}
                        onChange={(v) => set({ wireframe: v })}
                        label="Clay"
                    />
                </div>
            </div>
        </div>
    );
}
