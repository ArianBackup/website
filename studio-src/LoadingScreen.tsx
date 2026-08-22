/**
 * LoadingScreen / LoadingProgress — the Sculptr model-generation loader.
 *
 * Same composition as the app: SculptLoader fills the area, with the glass card
 * of stepper bars + progress + rotating status line pinned to the bottom. The
 * app builds the card from its Stepper/Progress primitives and a ThinkingOrb;
 * those are reproduced here in plain markup against the same tokens, since this
 * bundle carries neither Radix nor the orb package.
 *
 * The Cancel control is dropped — inside the portfolio there is no scan to
 * abandon and nowhere to go back to.
 */
import React from 'react';
import { SculptLoader } from './SculptLoader';
import { LOADING_STEPS } from './loading-copy';

export interface LoadingProgressProps {
    progress: number;
    activeStep: number;
    statusLine: string;
    label?: string;
}

export function LoadingProgress({
    progress,
    activeStep,
    statusLine,
    label = 'Sculpting your model',
}: LoadingProgressProps) {
    return (
        <div>
            <div className="lp-steps">
                {LOADING_STEPS.map((step, index) => {
                    const n = index + 1;
                    const state = n < activeStep ? 'completed' : n === activeStep ? 'active' : 'inactive';
                    return (
                        <div key={step.title} className="lp-step" data-state={state}>
                            <div className="lp-bar" />
                            <div className="lp-steptitle">{step.title}</div>
                        </div>
                    );
                })}
            </div>

            <div className="lp-meta">
                <div className="lp-row">
                    <span className="lp-label">{label}</span>
                    <span className="lp-pct">
                        {Math.round(progress)}%
                        <span className="lp-live" aria-hidden>
                            <span />
                            <span />
                        </span>
                    </span>
                </div>
                <div className="lp-track">
                    <div className="lp-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                </div>
                <div className="lp-status">
                    <span className="lp-orb" aria-hidden />
                    <span>{statusLine}</span>
                </div>
            </div>
        </div>
    );
}

export interface LoadingScreenProps {
    progress: number;
    activeStep: number;
    statusLine: string;
    complete?: boolean;
    label?: string;
}

export function LoadingScreen({
    progress,
    activeStep,
    statusLine,
    complete = false,
    label,
}: LoadingScreenProps) {
    return (
        <div className="lp-screen">
            <SculptLoader progress={progress / 100} complete={complete} />
            <div className="lp-cardwrap">
                <div className="lp-card">
                    <LoadingProgress
                        progress={progress}
                        activeStep={activeStep}
                        statusLine={statusLine}
                        label={label}
                    />
                </div>
            </div>
        </div>
    );
}

export default LoadingScreen;
