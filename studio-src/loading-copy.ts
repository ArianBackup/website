/* ---------------------------------------------------------------------------
 * loading-copy — shared step definitions + the "technical" status message bank
 * for the 3D model loading screen. These mirror the real reconstruction
 * pipeline (structure-from-motion → multi-view depth → mesh → morphable-model
 * fit → texture bake → meshopt/quantize GLB) so the wait reads as real work,
 * not gibberish. KeenTools gives us no granular progress, so the synthetic
 * progress controller (useSyntheticProgress) drives which message shows.
 * ------------------------------------------------------------------------- */

export interface LoadingStepDef {
  title: string;
}

/** The four stepper bars, reused verbatim from the style-lab "LOADING & STEPS". */
export const LOADING_STEPS: readonly LoadingStepDef[] = [
  { title: 'Upload photo' },
  { title: 'Build 3D model' },
  { title: 'Apply morphs' },
  { title: 'Done' },
];

/**
 * Upper bound (exclusive, in %) of each step's progress band. Progress maps to
 * the active step so the bars fill in lockstep with the synthetic curve:
 *   Upload   0–12   |  Build 12–62  |  Morphs 62–86  |  Review 86+
 */
export const STEP_BANDS: readonly number[] = [12, 62, 86, Infinity];

/** Map a 0–100 progress value to a 1-based active step. */
export function stepForProgress(progress: number): number {
  for (let i = 0; i < STEP_BANDS.length; i++) {
    if (progress < STEP_BANDS[i]) return i + 1;
  }
  return LOADING_STEPS.length;
}

/**
 * Per-step rotating status lines. Indexed by (step - 1). Real, context-accurate
 * stages of photogrammetric face reconstruction — believable detail to keep the
 * clinician engaged while the model is actually being built server-side.
 */
export const STATUS_MESSAGES: readonly (readonly string[])[] = [
  // 1 · Upload photo
  [
    'Validating image resolution & EXIF orientation…',
    'Isolating the face from the background…',
    'Detecting facial landmarks…',
    'Normalizing exposure & white balance…',
  ],
  // 2 · Build 3D model
  [
    'Estimating camera poses (structure-from-motion)…',
    'Triangulating multi-view geometry…',
    'Fusing depth maps into a point cloud…',
    'Reconstructing the facial mesh…',
    'Computing surface normals…',
  ],
  // 3 · Apply morphs
  [
    'Fitting the morphable face model…',
    'Solving identity & expression coefficients…',
    'Projecting blendshape targets…',
    'Baking diffuse texture maps…',
  ],
  // 4 · Review & approve
  [
    'Quantizing geometry (meshopt)…',
    'Reordering vertices for GPU cache…',
    'Compressing & packaging GLB…',
    'Finalizing model for the editor…',
  ],
];

/** Shown once real completion lands and the bar snaps to 100%. */
export const STATUS_READY = 'Model ready';
/** Shown when processing fails. */
export const STATUS_FAILED = 'Something went wrong';
