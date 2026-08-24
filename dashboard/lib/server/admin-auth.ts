/* ---------------------------------------------------------------------------
 * admin-auth.ts — the signed admin cookie, minted and checked.
 *
 * A lean port of Sculptr's `lib/server/admin/guard.ts`, which could not come
 * across as-is: it reaches into that app's error-reporting and issue-message
 * modules, and it also accepts an `x-admin-key` HEADER for scripts hitting its
 * /api/admin/* surface. There is no such surface here and a header door is not
 * one this app wants, so only the cookie path survives.
 *
 * The wire format is unchanged and has to be: `middleware.ts` verifies these
 * cookies with `unsignEdge`, which was copied over byte-for-byte because the
 * Edge runtime has no node:crypto. Both sides must produce the same HMAC over
 * the same SESSION_SECRET — `value.signature`, SHA-256, base64url.
 * ------------------------------------------------------------------------- */

import crypto from 'crypto';
import { serialize } from 'cookie';

/** Same name, payload and life as the original. */
export const ADMIN_COOKIE = 'sculptr_admin';
export const ADMIN_COOKIE_PREFIX = 'admin';
export const ADMIN_COOKIE_TTL_SECONDS = 60 * 60 * 12;

/* Kept identical to lib/server/auth-edge.ts, which reads the same env var and
 * falls back to the same string — a drift here would mean cookies this file
 * mints are rejected by the middleware that checks them. */
const FALLBACK_SESSION_SECRET = 'sculptr-preview-fallback-secret-do-not-use-in-prod';

function sessionSecret(): string {
  return process.env.SESSION_SECRET || FALLBACK_SESSION_SECRET;
}

function sign(value: string): string {
  const signature = crypto
    .createHmac('sha256', sessionSecret())
    .update(value)
    .digest('base64url');
  return `${value}.${signature}`;
}

/**
 * Is this the owner?
 *
 * A length check before `timingSafeEqual`, which throws on mismatched buffers
 * rather than returning false — and comparing with `===` would leak the length
 * of the secret through timing.
 */
export function verifyAdminKey(key: string): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length === 0) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createAdminCookie(): string {
  return serialize(ADMIN_COOKIE, sign(`${ADMIN_COOKIE_PREFIX}:${Date.now()}`), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    /* No `domain`. Host-only is what makes the proxy work: the browser thinks
       it is talking to arianfarhadi.com, so that is who it hands the cookie
       back to, whatever host actually served the response. */
    path: '/',
    maxAge: ADMIN_COOKIE_TTL_SECONDS,
  });
}

export function clearAdminCookie(): string {
  return serialize(ADMIN_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
