# Deploying the dashboard

Two Vercel projects, one repo.

| Project | Root directory | Domain | Build |
| --- | --- | --- | --- |
| `website` | `/` (repo root) | `arianfarhadi.com` | webpack → `public/` |
| `dashboard` | `dashboard/` | none of its own | Next.js |

The dashboard has no domain attached on purpose. The portfolio's
`vercel.json` proxies three path prefixes through to it, so the browser only
ever talks to `arianfarhadi.com`:

```
/hq-cstbflbv        →  dashboard
/hq-cstbflbv/:path* →  dashboard   (pages + the sign-in endpoint)
/_next/:path*       →  dashboard   (chunks, CSS, the Satoshi fonts)
```

One origin is the whole point. The admin cookie is host-only, so the browser
hands it back to `arianfarhadi.com` whatever host actually served the
response — and `localStorage`, which is where every note, task and habit
lives, is keyed by origin. Serve the portal from a second hostname and it is
a second, empty document.

## First-time setup

1. **Create the Vercel project.** Import `ArianBackup/website` again, name it
   `dashboard`, set **Root Directory** to `dashboard`. Framework autodetects
   as Next.js. The name matters: the rewrites above point at
   `dashboard-arians-projects-9ab864c3.vercel.app`, which is derived from it.
2. **Set two environment variables** on that project, Production and Preview:
   - `ADMIN_SECRET` — the passphrase the sign-in screen accepts. Without it
     nobody can get in: `verifyAdminKey` returns false when it is unset.
   - `SESSION_SECRET` — signs the cookie. Any long random string. If it is
     unset the code falls back to a shared constant that is public in the
     source, so set it.
3. **Do not attach a domain** to the `dashboard` project. It is reached only
   through the proxy.
4. **Leave Deployment Protection off** for its production deployment, or the
   proxy will be answered by Vercel's login wall rather than by the app.

## Moving your data

`localStorage` does not cross origins, so a document built at one domain is
simply not present at another. Nothing syncs; nothing is on a server.

1. On the **old** origin, before it goes away: `⌘K` → **Export JSON**.
2. On `arianfarhadi.com/hq-cstbflbv`, sign in, then **Restore a backup** on
   the first-run screen (or `⌘K` → **Import JSON** if you already have a
   document here).

The import is validated before it replaces anything, so a wrong file is
refused rather than half-applied.

## Gotcha

The `dashboard` project's own `*.vercel.app` URL also serves the portal, behind
the same wall — but it is a **different origin**, so it has its own empty
`localStorage`. Always use `arianfarhadi.com`.
