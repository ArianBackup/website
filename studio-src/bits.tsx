/**
 * Shared panel bits — the app keeps these in app/studio/components/bits.tsx and
 * every panel draws from them, so the sculpt sliders and the lighting sliders
 * are the same control.
 */
import React from 'react';

export function FlowSlider({
    label,
    value,
    min,
    max,
    step = 1,
    suffix,
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
    /** Unit shown after the readout (°, %, …). */
    suffix?: string;
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
                    <span className="st-slider-value">
                        {Math.round(value)}
                        {suffix}
                    </span>
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

/** The app's LiquidToggle, reduced to the switch itself. */
export function Toggle({
    checked,
    onChange,
    label,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
}) {
    return (
        <button
            type="button"
            className="st-toggle"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            data-on={checked}
            onClick={() => onChange(!checked)}
        >
            <span className="st-toggle-knob" aria-hidden />
        </button>
    );
}
