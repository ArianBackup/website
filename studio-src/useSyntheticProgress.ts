import { useEffect, useRef, useState } from 'react';
import {
  LOADING_STEPS,
  STATUS_FAILED,
  STATUS_MESSAGES,
  STATUS_READY,
  stepForProgress,
} from './loading-copy';

/* ---------------------------------------------------------------------------
 * useSyntheticProgress — drives the loading screen's progress bar + stepper +
 * status line WITHOUT real granular progress from KeenTools.
 *
 * The curve eases asymptotically toward a cap (so it never reaches 100% on its
 * own → never lies, never looks "done early") while a tiny linear term keeps it
 * always visibly creeping (→ never looks stuck). It only snaps to 100% when the
 * caller flips `complete` (the real model is ready). If a real 0–1 progress
 * ever appears it's taken as a floor (can pull ahead, never regresses).
 * ------------------------------------------------------------------------- */

export type SyntheticPhase = 'running' | 'complete' | 'failed';

export interface UseSyntheticProgressOptions {
  /** Flip to true when the real model is ready (status completed + prepared). Snaps to 100%. */
  complete?: boolean;
  /** Flip to true on failure. Freezes the curve and reports `failed`. */
  failed?: boolean;
  /** Real backend progress 0..1, if it ever shows up. Used as a floor. */
  realProgress?: number | null;
  /** Change this value to restart the run from 0 (used by the preview's "Restart"). */
  runKey?: number | string;
  /** Asymptote the eased term approaches, in %. Default 88. */
  cap?: number;
  /** Time constant of the ease, in seconds. Larger = slower. Default 45. */
  tau?: number;
  /** Constant creep added on top, in %/sec, so it never stalls. Default 0.04. */
  creepPerSec?: number;
  /** Absolute ceiling before completion, in %. Default 96. */
  hardCap?: number;
  /** ms between status-line rotations. Default 2800. */
  rotateMs?: number;
  /** ms for the snap-to-100 animation once complete. Default 650. */
  completeDurationMs?: number;
}

export interface SyntheticProgressState {
  /** 0..100, full precision (round for display). */
  progress: number;
  /** 1-based active step. */
  activeStep: number;
  /** Current rotating status line. */
  statusLine: string;
  phase: SyntheticPhase;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useSyntheticProgress({
  complete = false,
  failed = false,
  realProgress = null,
  runKey = 0,
  cap = 88,
  tau = 45,
  creepPerSec = 0.04,
  hardCap = 96,
  rotateMs = 2800,
  completeDurationMs = 650,
}: UseSyntheticProgressOptions = {}): SyntheticProgressState {
  const [state, setState] = useState<SyntheticProgressState>({
    progress: 0,
    activeStep: 1,
    statusLine: STATUS_MESSAGES[0][0],
    phase: 'running',
  });

  // Live inputs read inside the rAF loop without restarting it.
  const completeRef = useRef(complete);
  const failedRef = useRef(failed);
  const realRef = useRef<number | null>(realProgress);
  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);
  useEffect(() => {
    failedRef.current = failed;
  }, [failed]);
  useEffect(() => {
    realRef.current = realProgress ?? null;
  }, [realProgress]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    let maxProgress = 0; // monotonic — progress never goes backwards
    let stepStart = start; // when the current step began (for status rotation)
    let curStep = 1;
    let completeStart: number | null = null;
    let completeFrom = 0;

    // emitted snapshot, to throttle setState
    let lastP = -1;
    let lastStep = -1;
    let lastStatus = '';
    let lastPhase: SyntheticPhase | '' = '';

    const tick = (now: number) => {
      // Terminal: failure freezes the bar where it is.
      if (failedRef.current) {
        commit(maxProgress, curStep, STATUS_FAILED, 'failed');
        return; // stop the loop
      }

      let p: number;
      let phase: SyntheticPhase = 'running';

      if (completeRef.current) {
        if (completeStart === null) {
          completeStart = now;
          completeFrom = maxProgress;
        }
        const ct = Math.min((now - completeStart) / completeDurationMs, 1);
        p = completeFrom + (100 - completeFrom) * easeOutCubic(ct);
        if (ct >= 1) {
          p = 100;
          phase = 'complete';
        }
      } else {
        const t = (now - start) / 1000;
        const eased = cap * (1 - Math.exp(-t / tau));
        const creep = creepPerSec * t;
        const synthetic = Math.min(hardCap, eased + creep);
        const real = realRef.current != null ? realRef.current * 100 : 0;
        p = Math.max(synthetic, real);
      }

      // Monotonic.
      if (p < maxProgress) p = maxProgress;
      maxProgress = p;

      // Active step from the band, but on completion force the last step.
      const step = phase === 'complete' || completeRef.current ? LOADING_STEPS.length : stepForProgress(p);
      if (step !== curStep) {
        curStep = step;
        stepStart = now;
      }

      // Rotating status line for the current step.
      let statusLine: string;
      if (phase === 'complete') {
        statusLine = STATUS_READY;
      } else if (completeRef.current) {
        statusLine = 'Wrapping up…';
      } else {
        const bank = STATUS_MESSAGES[curStep - 1] ?? STATUS_MESSAGES[0];
        const idx = Math.floor((now - stepStart) / rotateMs) % bank.length;
        statusLine = bank[idx];
      }

      commit(p, curStep, statusLine, phase);

      if (phase !== 'complete') raf = requestAnimationFrame(tick);
    };

    const commit = (p: number, step: number, statusLine: string, phase: SyntheticPhase) => {
      const rp = Math.round(p * 10) / 10; // 0.1% granularity bounds re-renders
      if (rp === lastP && step === lastStep && statusLine === lastStatus && phase === lastPhase) return;
      lastP = rp;
      lastStep = step;
      lastStatus = statusLine;
      lastPhase = phase;
      setState({ progress: rp, activeStep: step, statusLine, phase });
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, cap, tau, creepPerSec, hardCap, rotateMs, completeDurationMs]);

  return state;
}
