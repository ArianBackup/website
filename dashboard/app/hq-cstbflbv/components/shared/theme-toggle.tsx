'use client';

/* ---------------------------------------------------------------------------
 * ThemeToggle — light ⇄ dark, as a control rather than a checkbox.
 *
 * It is deliberately built from the same parts as the view switcher in the
 * header: the `.pa-seg` track, the `.pa-seg-pill` thumb, and one shared-element
 * `layoutId` so the thumb SLIDES between the sun and the moon instead of
 * blinking. Two surfaces, one mechanism — that is what makes the portal feel
 * like one product.
 *
 * ── Why a group and not a switch ──────────────────────────────────────────
 * There were three themes for a while — light, dark, and the London map — and
 * `role="switch"` could not describe that, since `aria-checked` promises a
 * binary and had nowhere to point. The map is now dark mode's own ground rather
 * than a third choice, so this IS binary again. It stays a `role="group"` of
 * two named buttons anyway: it matches the header's switcher, both states are
 * visible and directly clickable rather than one being a guess about what
 * pressing will do, and it is the same shape if a third ground ever returns.
 *
 * The icon slots are decoration and stay hidden from assistive tech; the button
 * itself carries the name.
 *
 * Before the stored choice has been read (`ready === false`) the track renders
 * at full size with no thumb, so the header cannot reflow when it arrives and
 * we never paint the wrong state for a frame.
 * ------------------------------------------------------------------------- */

import { useCallback, useId, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { Moon, Sun, type LucideIcon } from 'lucide-react';

import { useAssistantTheme, THEME_ORDER, type PaTheme } from '../../lib/theme';
import { BrightnessDial, useBrightnessHotkey, useLongPress } from './brightness-dial';

const META: Record<PaTheme, { icon: LucideIcon; label: string }> = {
  light: { icon: Sun, label: 'Light theme' },
  // The moon, not a map pin: what this selects is dark mode. That it stands on
  // London is the ground it comes with, not the thing being chosen.
  dark: { icon: Moon, label: 'Dark theme — London behind the portal' },
};

/**
 * `.pa-seg-btn` is padded for a text label; an icon-only slot in a 36px track
 * needs to be tighter and to fill the track's inner height so the thumb behind
 * it does too. Inline because the class selector outranks a utility.
 */
const SLOT: CSSProperties = { alignSelf: 'stretch', padding: '0 0.62rem' };

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps): JSX.Element {
  const { theme, setTheme, ready } = useAssistantTheme();
  const reduce = useReducedMotion() ?? false;

  /* ---- the dimmer, hidden behind this control ----
   * Nothing about it is drawn until it is asked for. See brightness-dial.tsx
   * for why it lives here and why the gesture is a long press. */
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dialOpen, setDialOpen] = useState(false);
  const openDial = useCallback(() => setDialOpen(true), []);
  const closeDial = useCallback(() => setDialOpen(false), []);
  const { handlers: pressHandlers, shouldSuppressClick } = useLongPress(openDial);
  useBrightnessHotkey(openDial);

  // Scoped so two toggles on one page cannot capture each other's thumb.
  const pillId = `pa-theme-thumb-${useId()}`;

  const pillTransition = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 380, damping: 32 } as const);

  const iconTransition = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 420, damping: 30 } as const);

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label="Theme"
      className={clsx('pa-seg h-11 shrink-0 select-none sm:h-9', className)}
      {...pressHandlers}
    >
      {THEME_ORDER.map((mode) => {
        const active = ready && theme === mode;
        const { icon: Icon, label } = META[mode];

        return (
          <button
            key={mode}
            type="button"
            onClick={() => {
              // A press that revealed the dimmer still ends in a click on this
              // button; swallow exactly that one so the theme does not flip on
              // the way out of the gesture.
              if (shouldSuppressClick()) return;
              setTheme(mode);
            }}
            aria-pressed={ready ? active : false}
            aria-label={label}
            data-tip={label}
            data-active={active}
            className="pa-seg-btn pa-focus"
            style={SLOT}
          >
            {active ? (
              // `initial={false}` keeps the thumb from fading in on the first
              // paint after `ready` — it simply appears where it belongs, then
              // slides for every change after that.
              <motion.span
                layoutId={pillId}
                initial={false}
                className="pa-seg-pill"
                transition={pillTransition}
              />
            ) : null}

            <motion.span
              className="relative z-[1] inline-flex"
              aria-hidden="true"
              animate={
                reduce
                  ? { opacity: active ? 1 : 0.5 }
                  : {
                      opacity: active ? 1 : 0.5,
                      scale: active ? 1 : 0.88,
                      // The dormant icon tilts away from the thumb it is
                      // waiting for — the sun anticlockwise, the moon the
                      // other way — so the pair reads as one mechanism.
                      rotate: active ? 0 : mode === 'light' ? -28 : 28,
                    }
              }
              transition={iconTransition}
            >
              <Icon
                className="size-4"
                strokeWidth={1.75}
                fill={active && mode === 'dark' ? 'currentColor' : 'none'}
                fillOpacity={active && mode === 'dark' ? 0.16 : 0}
              />
            </motion.span>
          </button>
        );
      })}
      <BrightnessDial open={dialOpen} onClose={closeDial} anchorRef={trackRef} />
    </div>
  );
}
