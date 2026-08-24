/* Unreachable in practice — the middleware rewrites every non-portal path to
   the 404 before it gets here, and in production nothing routes `/` to this
   app at all. It exists so `next build` has a root route to emit. */
import NotFound from './not-found';

export default function RootPage() {
  return <NotFound />;
}
