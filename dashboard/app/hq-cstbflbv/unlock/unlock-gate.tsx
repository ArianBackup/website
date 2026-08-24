'use client';

/* ---------------------------------------------------------------------------
 * unlock-gate.tsx — the sign-in for the private portal.
 *
 * Deliberately says nothing about what is behind it. `/admin`'s gate announces
 * "Platform owner access — clinics, sessions & system", which is right for a
 * path anyone can guess; this one sits on a path whose whole value is that
 * nobody knows it exists, and a page that names the thing it guards gives that
 * away to the first person who stumbles in.
 *
 * Built on the same `AuthScreen` shell as every other auth surface in the app,
 * so it scrolls properly on a short phone viewport and carries the same
 * backdrop — see components/auth/auth-screen.tsx.
 * ------------------------------------------------------------------------- */

import { useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { clsx } from 'clsx';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock } from 'lucide-react';

import { AuthScreen } from '@/components/auth/auth-screen';
import { GlassButton } from '@/components/ui/glass-button';

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

export function UnlockGate(): JSX.Element {
  const reduce = useReducedMotion();

  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const disabled = busy || key.trim().length === 0;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const secret = key.trim();
    if (secret.length === 0 || busy) return;

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/hq-cstbflbv/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: secret }),
      });
      if (!res.ok) {
        /* The endpoint's own wording is "That admin secret was rejected",
         * which tells whoever is typing exactly which credential they are
         * guessing at and undoes the point of an anonymous gate. Rate limiting
         * is the one case worth passing through, because it explains a refusal
         * the person cannot otherwise account for. */
        setError(res.status === 429 ? 'Too many attempts. Wait a minute.' : 'That did not work.');
        setBusy(false);
        return;
      }

      /* A FULL page load, not `router.replace`.
       *
       * The gate is served by a middleware rewrite, so what changes on a
       * successful sign-in is not the URL — it is the cookie the next request
       * carries. The App Router has this exact URL cached as "the sign-in
       * page"; `refresh()` plus `replace()` re-fetched it and rendered the gate
       * again, and only a manual reload got in. A document navigation is the
       * one thing guaranteed to re-run the middleware. */
      setKey('');
      window.location.replace('/hq-cstbflbv');
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <motion.div
        initial={{ opacity: 0, y: reduce ? 0 : 18, scale: reduce ? 1 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: HOUSE_EASE }}
        className="w-full max-w-sm text-center"
      >
        <div className="mb-6 flex justify-center">
          <span className="grid size-12 place-items-center rounded-2xl border border-[rgba(0,153,255,0.25)] bg-[rgba(0,153,255,0.1)]">
            <Lock className="size-5 text-[color:var(--azure)]" strokeWidth={1.9} />
          </span>
        </div>

        <h1 className="text-xl font-extrabold tracking-tight text-[color:var(--navy)]">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">This page is private.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="Passphrase"
              autoFocus
              autoComplete="current-password"
              aria-label="Passphrase"
              aria-invalid={error.length > 0}
              /* 16px exactly. Anything smaller and iOS Safari zooms the page in
                 on focus and never zooms back out. */
              className="h-12 w-full rounded-full border border-[rgba(15,57,139,0.14)] bg-white/70 px-12 text-center text-base text-[color:var(--navy)] outline-none transition-[border-color,box-shadow] placeholder:text-[rgba(15,57,139,0.35)] focus:border-[rgba(0,153,255,0.55)] focus:shadow-[0_0_0_3px_rgba(0,153,255,0.12)]"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide the passphrase' : 'Show the passphrase'}
              className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-[rgba(15,57,139,0.45)] transition-colors hover:text-[color:var(--navy)]"
            >
              {show ? (
                <EyeOff className="size-4" strokeWidth={1.9} />
              ) : (
                <Eye className="size-4" strokeWidth={1.9} />
              )}
            </button>
          </div>

          {error ? (
            <p
              role="alert"
              className="flex items-center justify-center gap-1.5 text-[13px] text-[color:var(--destructive,#c9564f)]"
            >
              <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} />
              {error}
            </p>
          ) : null}

          {/* Exactly how /admin's gate drives this component, and for the two
              reasons its source spells out.

              The wrap keeps its `w-fit`. Its shadow layer is sized to 100% of
              the wrap, so a `w-full` there stretches the shadow while the
              button stays content-width — a wide ghost pill behind a small
              one, which is the failure the component's own comment warns
              about. `mx-auto` centres it instead.

              And the label is a `block`, not a flex row, so "Continue" and its
              arrow stacked; `gap-2` on the BUTTON could never reach them. The
              `!flex` is what turns the label into the row, and it needs the
              bang to outrank the variant's `block`. */}
          <GlassButton
            type="submit"
            disabled={disabled}
            contentClassName="!flex items-center justify-center gap-2 whitespace-nowrap"
            className={clsx(
              'glass-button--haze-light mx-auto',
              disabled && 'pointer-events-none opacity-60',
            )}
          >
            {busy ? 'Checking…' : 'Continue'}
            {busy ? null : <ArrowRight className="size-4" strokeWidth={2} />}
          </GlassButton>
        </form>
      </motion.div>
    </AuthScreen>
  );
}
