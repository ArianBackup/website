import type { Metadata } from 'next';
import { UnlockGate } from './unlock-gate';

/* ---------------------------------------------------------------------------
 * The one door into the private portal.
 *
 * Middleware sends two kinds of request here: the exact path, and the portal's
 * root when nobody is signed in. Anything deeper 404s instead, so this page is
 * the only thing an unauthenticated visitor can ever see under the prefix.
 *
 * It authenticates against the SAME credential as /admin — POST
 * /hq-cstbflbv/api/unlock, which checks ADMIN_SECRET and mints the 12-hour signed
 * httpOnly `sculptr_admin` cookie. There is no second secret to keep, no second
 * cookie, and no new attack surface: this is a second entrance to a wall that
 * was already there, and it inherits that endpoint's rate limiting (10 attempts
 * a minute per IP) along with everything else.
 * ------------------------------------------------------------------------- */

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function UnlockPage() {
  return <UnlockGate />;
}
