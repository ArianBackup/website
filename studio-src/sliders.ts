/**
 * Morph-slider catalogue + helpers.
 *
 * The app ships 8 categories / 56 controls (components/panels/SliderPanel.tsx).
 * This demo carries the nose groups — Sculptr's core case — plus the brow and
 * jaw the seeded sculpt below touches, all verbatim, and the resolution helpers
 * from app/studio/lib/sliders.ts unchanged. Adding a category back is just
 * another entry in CATEGORIES; every label below drives a morph target that
 * exists on the head.
 */

export interface SliderDef {
    label: string;
    morphTargets: string[];
}

export interface SliderCategory {
    name: string;
    sliders: SliderDef[];
}

export const CATEGORIES: SliderCategory[] = [
    {
        name: 'Main Nose Features',
        sliders: [
            { label: 'Nose Bulbous', morphTargets: ['Nose Bulbous'] },
            { label: 'Nose Depth', morphTargets: ['Nose Depth'] },
            { label: 'Nose Droop', morphTargets: ['Nose Droop'] },
            { label: 'Nose Height', morphTargets: ['Nose Height'] },
            { label: 'Nose Relative Depth', morphTargets: ['Nose Relative Depth'] },
            { label: 'Nose Scale', morphTargets: ['Nose Scale'] },
            { label: 'Nose Upturn', morphTargets: ['Nose Upturn'] },
            { label: 'Nose Width', morphTargets: ['Nose Width'] },
        ],
    },
    {
        name: 'Nose Tip',
        sliders: [
            { label: 'Nose Tip Angle', morphTargets: ['Nose Tip Angle'] },
            { label: 'Nose Tip Center Depth', morphTargets: ['Nose Tip Center Depth'] },
            { label: 'Nose Tip Depth', morphTargets: ['Nose Tip Depth'] },
            { label: 'Nose Tip Height', morphTargets: ['Nose Tip Height'] },
            { label: 'Nose Tip Lower Depth', morphTargets: ['Nose Tip Lower Depth'] },
            { label: 'Nose Tip Median Depth', morphTargets: ['Nose Tip Median Depth'] },
            { label: 'Nose Tip Scale', morphTargets: ['Nose Tip Scale'] },
            { label: 'Nose Tip Upper Depth', morphTargets: ['Nose Tip Upper Depth'] },
            { label: 'Nose Tip Width', morphTargets: ['Nose Tip Width'] },
        ],
    },
    {
        name: 'Nostril Controls',
        sliders: [
            {
                label: 'Nostril Angle Side',
                morphTargets: ['Nostril Angle Side', 'Nostril Angle Side L', 'Nostril Angle Side R'],
            },
            { label: 'Nostril Height', morphTargets: ['Nostril Height', 'Nostril Height L', 'Nostril Height R'] },
            { label: 'Nostril Scale', morphTargets: ['Nostril Scale', 'Nostril Scale L', 'Nostril Scale R'] },
            {
                label: 'Nostril Scale Height',
                morphTargets: ['Nostril Scale Height', 'Nostril Scale Height L', 'Nostril Scale Height R'],
            },
            { label: 'Nostril Width', morphTargets: ['Nostril Width', 'Nostril Width L', 'Nostril Width R'] },
        ],
    },
    {
        name: 'Nose Ridge',
        sliders: [
            { label: 'Nose Ridge Angle', morphTargets: ['Nose Ridge Angle'] },
            { label: 'Nose Ridge Curve', morphTargets: ['Nose Ridge Curve'] },
            { label: 'Nose Ridge Define', morphTargets: ['Nose Ridge Define'] },
            { label: 'Nose Ridge Depth', morphTargets: ['Nose Ridge Depth'] },
            { label: 'Nose Ridge Lower Define', morphTargets: ['Nose Ridge Lower Define'] },
            { label: 'Nose Ridge Lower Depth', morphTargets: ['Nose Ridge Lower Depth'] },
            { label: 'Nose Ridge Middle Depth', morphTargets: ['Nose Ridge Middle Depth'] },
            { label: 'Nose Ridge Offset', morphTargets: ['Nose Ridge Offset'] },
            { label: 'Nose Ridge Upper Define', morphTargets: ['Nose Ridge Upper Define'] },
            { label: 'Nose Ridge Upper Depth', morphTargets: ['Nose Ridge Upper Depth'] },
            { label: 'Nose Ridge Width', morphTargets: ['Nose Ridge Width'] },
        ],
    },
    {
        name: 'Brow',
        sliders: [
            { label: 'Brow Down Left', morphTargets: ['browDownLeft'] },
            { label: 'Brow Down Right', morphTargets: ['browDownRight'] },
            { label: 'Brow Inner Up', morphTargets: ['browInnerUp'] },
            { label: 'Brow Outer Up Left', morphTargets: ['browOuterUpLeft'] },
            { label: 'Brow Outer Up Right', morphTargets: ['browOuterUpRight'] },
        ],
    },
    {
        name: 'Jaw',
        sliders: [
            { label: 'Jaw Forward', morphTargets: ['jawForward'] },
            { label: 'Jaw Left', morphTargets: ['jawLeft'] },
            { label: 'Jaw Open', morphTargets: ['jawOpen'] },
            { label: 'Jaw Right', morphTargets: ['jawRight'] },
        ],
    },
];

/**
 * The sculpt the head arrives with — a worked consult rather than an untouched
 * scan, so the compare views have something to compare and the panel opens on
 * real values. Keyed by morph target; anything absent is 0.
 */
export const SEED_SLIDERS: Record<string, number> = {
    'Nose Depth': -31,
    'Nose Height': -8,
    'Nose Relative Depth': 24,
    'Nose Scale': -35,
    'Nose Upturn': 73,
    'Nose Width': -3,
    'Nose Ridge Curve': -32,
    browOuterUpLeft: 30,
    browOuterUpRight: 30,
    jawForward: 33,
};

/** Targets that actually exist on the loaded mesh (fallback: declared list). */
export function getEffectiveTargets(slider: SliderDef, available?: string[]): string[] {
    if (!available || available.length === 0) return slider.morphTargets;
    const avSet = new Set(available);
    const matched = slider.morphTargets.filter((t) => avSet.has(t));
    return matched.length > 0 ? matched : slider.morphTargets;
}

/** Current value for a slider (first matching target wins; 0 when untouched). */
export function getSliderValue(
    slider: SliderDef,
    values: Record<string, number>,
    available?: string[],
): number {
    for (const t of getEffectiveTargets(slider, available)) {
        if (values[t] !== undefined) return values[t];
    }
    return 0;
}

/** Does this slider drive at least one morph target present on the mesh? */
export function sliderIsAvailable(slider: SliderDef, available?: string[]): boolean {
    if (!available || available.length === 0) return true;
    const avSet = new Set(available);
    return slider.morphTargets.some((t) => avSet.has(t));
}

/** Categories filtered to the loaded mesh. */
export function getVisibleCategories(available?: string[]): SliderCategory[] {
    if (!available || available.length === 0) return CATEGORIES;
    const filtered = CATEGORIES.map((cat) => ({
        name: cat.name,
        sliders: cat.sliders.filter((s) => sliderIsAvailable(s, available)),
    })).filter((cat) => cat.sliders.length > 0);
    return filtered.length > 0 ? filtered : CATEGORIES;
}

/** Apply one slider's value across all of its effective morph targets. */
export function applySlider(
    values: Record<string, number>,
    slider: SliderDef,
    value: number,
    available?: string[],
): Record<string, number> {
    const next = { ...values };
    for (const t of getEffectiveTargets(slider, available)) next[t] = value;
    return next;
}

/** A map that zeroes every catalogue target plus any currently-set key. */
export function zeroedValues(current: Record<string, number>): Record<string, number> {
    const next: Record<string, number> = {};
    for (const cat of CATEGORIES) {
        for (const slider of cat.sliders) {
            for (const t of slider.morphTargets) next[t] = 0;
        }
    }
    for (const key of Object.keys(current)) next[key] = 0;
    return next;
}

/** How many sliders in a category are non-zero right now. */
export function activeCount(
    cat: SliderCategory,
    values: Record<string, number>,
    available?: string[],
): number {
    return cat.sliders.reduce(
        (n, s) => n + (Math.round(getSliderValue(s, values, available)) !== 0 ? 1 : 0),
        0,
    );
}
