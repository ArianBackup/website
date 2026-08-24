/**
 * Edge-compatible cookie validation for middleware.
 * Uses Web Crypto API (crypto.subtle) instead of Node.js crypto.
 * This module can safely run in Edge Runtime.
 */

const COOKIE_NAME = 'sculptr_session';

// Must match lib/server/auth.ts so cookies signed there validate here, and so
// middleware doesn't throw when SESSION_SECRET isn't configured.
const FALLBACK_SESSION_SECRET = 'sculptr-preview-fallback-secret-do-not-use-in-prod';

function getSecret(): string {
  return process.env.SESSION_SECRET || FALLBACK_SESSION_SECRET;
}

/**
 * Convert a string to ArrayBuffer (UTF-8)
 */
function encode(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer as ArrayBuffer;
}

/**
 * Convert ArrayBuffer to base64url string (matching Node.js crypto output)
 */
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Edge-compatible HMAC-SHA256 unsign.
 * Returns the original value if signature is valid, null otherwise.
 */
export async function unsignEdge(signedValue: string, secret?: string): Promise<string | null> {
  const lastDot = signedValue.lastIndexOf('.');
  if (lastDot === -1) return null;

  const value = signedValue.slice(0, lastDot);
  const actualSignature = signedValue.slice(lastDot + 1);
  const s = secret ?? getSecret();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encode(s),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encode(value));
    const expectedSignature = bufferToBase64url(signatureBuffer);

    // Constant-time comparison (best effort in JS)
    if (expectedSignature.length !== actualSignature.length) return null;
    let mismatch = 0;
    for (let i = 0; i < expectedSignature.length; i++) {
      mismatch |= expectedSignature.charCodeAt(i) ^ actualSignature.charCodeAt(i);
    }
    if (mismatch !== 0) return null;

    return value;
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
