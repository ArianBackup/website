/* ---------------------------------------------------------------------------
 * icons.ts — safe, typed icon resolution.
 *
 * Life areas and habits store their icon as a plain string so the document
 * stays serialisable. `iconFor()` turns that string back into a component and
 * NEVER throws: an unknown or hand-edited name quietly falls back to `Circle`.
 *
 * The registry is explicit rather than a wildcard import of lucide-react's
 * whole catalogue — that would defeat tree-shaking and ship ~1,600 icons to
 * the browser for the sake of two dozen.
 * ------------------------------------------------------------------------- */

import {
  Activity,
  Anchor,
  Apple,
  Bed,
  Bike,
  BookOpen,
  Brain,
  Briefcase,
  Camera,
  Circle,
  Code,
  Coffee,
  Compass,
  CreditCard,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  GraduationCap,
  HandHeart,
  Heart,
  Home,
  Leaf,
  Lightbulb,
  Moon,
  Mountain,
  Music,
  NotebookPen,
  Palette,
  PenLine,
  PiggyBank,
  Plane,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** The registry `iconFor()` looks into. Keys are lucide's PascalCase names. */
const ICON_REGISTRY: Readonly<Record<string, LucideIcon>> = {
  Activity,
  Anchor,
  Apple,
  Bed,
  Bike,
  BookOpen,
  Brain,
  Briefcase,
  Camera,
  Circle,
  Code,
  Coffee,
  Compass,
  CreditCard,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  GraduationCap,
  HandHeart,
  Heart,
  Home,
  Leaf,
  Lightbulb,
  Moon,
  Mountain,
  Music,
  NotebookPen,
  Palette,
  PenLine,
  PiggyBank,
  Plane,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Wind,
  Zap,
};

/**
 * Resolves a stored icon name to a lucide component.
 * Tolerates `''`, `undefined`-ish values and names that no longer exist.
 */
export function iconFor(name: string): LucideIcon {
  if (typeof name !== 'string' || name.length === 0) return Circle;
  const direct = ICON_REGISTRY[name];
  if (direct) return direct;
  // Second chance for casing drift ('bookOpen', 'book-open', 'BOOKOPEN').
  const normalised = name.replace(/[^a-z]/gi, '').toLowerCase();
  for (const key of Object.keys(ICON_REGISTRY)) {
    if (key.toLowerCase() === normalised) return ICON_REGISTRY[key];
  }
  return Circle;
}

/** True when the name resolves to a real icon rather than the fallback. */
export function hasIcon(name: string): boolean {
  return iconFor(name) !== Circle || name === 'Circle';
}

/** The curated set offered in every icon picker — areas, goals and habits. */
export const ICON_CHOICES: string[] = [
  'Heart',
  'Dumbbell',
  'Brain',
  'Briefcase',
  'Wallet',
  'Users',
  'BookOpen',
  'Sparkles',
  'Target',
  'Sunrise',
  'Moon',
  'Leaf',
  'Code',
  'Palette',
  'Music',
  'Plane',
  'Home',
  'GraduationCap',
  'Activity',
  'Coffee',
  'Camera',
  'Mountain',
  'Zap',
  'Compass',
];

/**
 * Area accents. A cool-to-warm ramp that all sit comfortably on white paper
 * beside the azure/navy brand: azure, cobalt, indigo, violet, teal, emerald,
 * amber, coral.
 */
export const AREA_COLORS: string[] = [
  '#0099ff',
  '#2f7be0',
  '#5b6ee0',
  '#7c5cd6',
  '#00a3a3',
  '#0f9d6e',
  '#b4761f',
  '#c9564f',
];

/** Deterministic colour for anything that has an id but no chosen accent. */
export function colorForIndex(index: number): string {
  const i = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return AREA_COLORS[i % AREA_COLORS.length];
}
