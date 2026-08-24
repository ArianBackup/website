/* The 404 the wall rewrites to. Deliberately says nothing — a stranger who
   guessed at the portal's path and a stranger who typed nonsense get the same
   page, because a distinctive 404 is a confirmation. */
export default function NotFound() {
  return (
    <div style={{ padding: '4rem 1.5rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>404</h1>
      <p style={{ fontSize: '0.9rem', opacity: 0.6, marginTop: '0.5rem' }}>
        This page could not be found.
      </p>
    </div>
  );
}
