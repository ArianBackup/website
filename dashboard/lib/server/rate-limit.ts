/* ---------------------------------------------------------------------------
 * rate-limit.ts — an in-memory throttle for the sign-in endpoint.
 *
 * Per-instance and therefore approximate: serverless spreads requests across
 * instances, so the real ceiling is the limit times however many are warm. It
 * is not trying to be a quota. It is trying to make guessing the secret slow
 * enough to be pointless, and it does that from any one instance.
 * ------------------------------------------------------------------------- */

const hits = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/** Returns seconds to wait, or null when the request is allowed through. */
export function rateLimit(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    /* Cheap sweep so a long-lived instance does not accumulate one entry per
       address that ever knocked. */
    if (hits.size > 500) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    return null;
  }

  entry.count += 1;
  if (entry.count > limit) return Math.ceil((entry.resetAt - now) / 1000);
  return null;
}
