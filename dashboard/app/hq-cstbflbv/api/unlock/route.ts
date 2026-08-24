/* ---------------------------------------------------------------------------
 * POST /hq-cstbflbv/api/unlock — exchange the secret for a signed cookie.
 *
 * UNDER the secret prefix, and that placement is the point. In Sculptr this
 * lived at /api/admin/auth, but the portfolio in front of this owns
 * arianfarhadi.com/api/* and the rewrite that proxies the portal is written
 * against one path prefix. Hanging the endpoint off that same prefix means one
 * rule covers the pages AND their sign-in, and the portfolio's own API
 * namespace is left alone.
 *
 * It also means the middleware would 404 it like everything else under the
 * prefix, so it is on the short allowlist there beside the sign-in page.
 * ------------------------------------------------------------------------- */

import { NextRequest, NextResponse } from 'next/server';

import { clearAdminCookie, createAdminCookie, verifyAdminKey } from '@/lib/server/admin-auth';
import { clientIp, rateLimit } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Ten a minute. Enough for a typo, useless for a dictionary.
  const retryAfter = rateLimit(`unlock:${clientIp(request)}`, 10, 60_000);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: 'Too many attempts.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const key = typeof body.key === 'string' ? body.key : '';
  if (key.length === 0 || !verifyAdminKey(key)) {
    /* Deliberately says nothing about which credential this is or why it
       failed — the gate in front of it is anonymous on purpose. */
    return NextResponse.json({ error: 'Rejected' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', createAdminCookie());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', clearAdminCookie());
  return res;
}
