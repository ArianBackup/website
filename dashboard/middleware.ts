/* ---------------------------------------------------------------------------
 * middleware.ts — the wall in front of the portal.
 *
 * Ported from Sculptr's, minus everything that was Sculptr's: no Supabase
 * session refresh, no protected route groups, no public marketing paths. This
 * app serves exactly one thing, so the wall is the whole file.
 *
 * The portal is hidden by URL and by 404, and BOTH matter. The path is not in
 * any sitemap or robots file — listing it there would be publishing it — and
 * anyone without the cookie gets a 404 indistinguishable from a URL that was
 * never there, so no crawler can reach it to index it in the first place.
 *
 * `PRIVATE_PREFIX` must match the directory under app/. Rename one and the
 * other stops guarding anything: the pages would still render, with no wall.
 * ------------------------------------------------------------------------- */

import { NextResponse, type NextRequest } from 'next/server';

import { unsignEdge } from '@/lib/server/auth-edge';

const PRIVATE_PREFIX = '/hq-cstbflbv';

/**
 * The two paths under the prefix that a signed-out request may reach: the
 * sign-in page, and the endpoint it posts to. Everything else 404s.
 */
const PRIVATE_UNLOCK = `${PRIVATE_PREFIX}/unlock`;
const PRIVATE_UNLOCK_API = `${PRIVATE_PREFIX}/api/unlock`;

// Mirrors lib/server/admin-auth.ts — same cookie, same payload, same 12h life.
const ADMIN_COOKIE = 'sculptr_admin';
const ADMIN_COOKIE_PREFIX = 'admin';
const ADMIN_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Is this request carrying a live admin session?
 *
 * `unsignEdge` and not a node:crypto unsign: middleware runs in the Edge
 * runtime, where node:crypto does not exist. The two produce byte-identical
 * HMACs over the same SESSION_SECRET, which is the whole reason the edge
 * variant exists.
 */
async function hasAdminSession(request: NextRequest): Promise<boolean> {
  const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!cookie) return false;

  const payload = await unsignEdge(cookie);
  if (!payload) return false;

  const [prefix, issuedAt] = payload.split(':');
  if (prefix !== ADMIN_COOKIE_PREFIX) return false;
  return Number(issuedAt) + ADMIN_COOKIE_TTL_MS > Date.now();
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPrivate = pathname === PRIVATE_PREFIX || pathname.startsWith(`${PRIVATE_PREFIX}/`);
  if (!isPrivate) {
    /* Nothing else in this app is meant to be reachable. The portfolio in
       front owns every other path; anything that lands here asked for
       something that does not exist. */
    return NextResponse.rewrite(new URL('/__not-found', request.url));
  }

  const open = pathname === PRIVATE_UNLOCK || pathname === PRIVATE_UNLOCK_API;
  if (!open && !(await hasAdminSession(request))) {
    /* The ROOT of the portal shows the sign-in, so a bookmark keeps working
       once the 12-hour cookie lapses — landing on a 404 twice a day and having
       to remember a second URL is not security, it is a trap you set for
       yourself. Everything deeper stays a 404 whatever the referer said. */
    if (pathname === PRIVATE_PREFIX) {
      return NextResponse.rewrite(new URL(PRIVATE_UNLOCK, request.url));
    }
    /* A rewrite to a path with no route, so Next renders its own not-found
       with a real 404. A redirect would confirm that something is there. */
    return NextResponse.rewrite(new URL('/__not-found', request.url));
  }

  return NextResponse.next();
}

export const config = {
  /* Everything except Next's own assets and the favicon — the wall has to see
     page requests, and there is nothing else here worth excluding. */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
