'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@web/lib/general/utils';
import { AuthBackground } from '@/components/brand/auth-background';

/** Ignore a few pixels of slack so the hint never flickers on a near-exact fit. */
const SLACK = 24;

/**
 * The full-screen shell every auth surface sits in — sign in / sign up, the
 * terms and pending-approval gates, password reset, account claim, admin login.
 *
 * It is `fixed inset-0` so the animated backdrop covers the viewport and the
 * page behind it never scrolls, which means THIS has to be the scroll
 * container. Two rules make that work:
 *
 *  - the scroller is `h-full` (a bounded height) and owns `overflow-y-auto`.
 *    Giving it `min-h-svh` instead lets it grow past the fixed parent, which
 *    then clips it with nothing to scroll — the sign-up form is taller than a
 *    phone viewport, so its bottom was simply unreachable.
 *  - the centring lives on an inner `min-h-full` flex box, not on the scroller.
 *    `items-center` on a scroll container centres the overflow, putting the top
 *    of tall content above the scrollable area where it can't be reached.
 *
 * Together: centred when the card fits, scrolls normally when it doesn't. When
 * it doesn't, a chevron points the way down — a full-bleed backdrop leaves no
 * scrollbar and no cropped content peeking past the fold, so there is otherwise
 * nothing telling you there is more below.
 */
export function AuthScreen({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  /** Extra classes for the scroll container. */
  className?: string;
  /** Extra classes for the centring box (e.g. `flex-col gap-6`). */
  contentClassName?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [showHint, setShowHint] = useState(false);
  const reduceMotion = useReducedMotion();

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const room = el.scrollHeight - el.clientHeight;
    setShowHint(room > SLACK && el.scrollTop < room - SLACK);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    // The card grows and shrinks as the view changes (sign in <-> sign up, an
    // error appearing), so watch the content box too, not just the viewport.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      ro.disconnect();
    };
  }, [sync]);

  const nudge = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({
      top: Math.round(el.clientHeight * 0.7),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [reduceMotion]);

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-white">
      <AuthBackground />

      <div
        ref={scrollerRef}
        className={cn('relative z-10 h-full overflow-y-auto overscroll-contain', className)}
      >
        <div
          className={cn(
            'flex min-h-full items-center justify-center px-4 py-12',
            // Clear the iOS home indicator — the layout ships viewport-fit=cover.
            'pb-[calc(3rem+env(safe-area-inset-bottom))]',
            contentClassName
          )}
        >
          {children}
        </div>
      </div>

      {/* Scroll affordance. The strip is inert so it can never eat a tap meant
         for the card; only the chevron itself is clickable. It stays pinned to
         the bottom edge: the cookie banner sits over it on a first visit, and
         it surfaces once that is dismissed. Lifting it clear of the banner was
         worse — on a short phone the banner is tall enough that the chevron
         landed in the middle of the form. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {showHint && (
            <motion.button
              type="button"
              onClick={nudge}
              aria-label="Scroll down for more"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full border border-white/70 bg-white/70 text-[color:var(--azure)] shadow-[0_6px_18px_-8px_rgba(15,57,139,0.45)] backdrop-blur transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--azure)]/40"
            >
              <motion.span
                aria-hidden="true"
                animate={reduceMotion ? undefined : { y: [0, 3, 0] }}
                transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
                className="flex"
              >
                <ChevronDown className="size-4" strokeWidth={2.5} />
              </motion.span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
