# Personal Assistant Portal

A private goal system at `/assistant`. It runs one cascade — **Life Area → Goal
(vision / year / quarter) → Milestone → Task** — with habits, reviews, an inbox
and analytics wrapped around it. Progress only ever flows up, and it is always
derived, never stored.

## The loops

**Daily.** Open *Today* → check the Big Three → capture anything new in the
quick-add bar → tick things off → close the day with the shutdown review (rate
it, reflect, set tomorrow's Big Three, which become real tasks).

**Weekly.** Run the weekly review (wins, misses, lessons) → set one focus
statement → lay the week out on the seven-day board.

**Quarterly.** Milestones complete, quarter goals fill, and those roll up into
the year and vision goals laddered above them.

## Surfaces

| View | What it is for |
| --- | --- |
| Today | The daily driver: live clock, Big Three, tasks, habits due, overdue, backlog, and the daily shutdown |
| Goals | The cascade, grouped by horizon, with rolled-up progress per goal and area |
| Week | Drag-and-drop seven-day board with a weekly focus and a backlog rail |
| Habits | Cadence-aware streaks and a 26-week heatmap per habit |
| Review | Guided daily shutdown and weekly retrospective, plus the history |
| Inbox | Frictionless capture, deliberate triage |
| Insights | Momentum, effort by life area, habit consistency, goal ladder |

Cross-cutting: `⌘K` command palette, number keys to switch views, `q` to focus
capture, light/dark themes, and JSON export/import.

## The live day

The portal follows the wall clock rather than the day it was opened on. The
store holds `today` and re-arms a timer for the next local midnight; because a
sleeping laptop never fires that timer on time, it also re-checks on window
focus and on `visibilitychange`, which is how the rollover is actually
experienced. Everything downstream — the Today view, the week board's current
column, "days left" on a goal — re-reads from it, so the day turns over without
a reload and the shutdown resets itself for the new day.

## Theming

Light and dark, driven by `data-pa-theme` on `<html>`, persisted under
`assistant.theme.v1`, and following `prefers-color-scheme` until the user picks
a side. A blocking inline script (`THEME_INIT_SCRIPT` in `lib/theme.ts`) sets
the attribute before first paint so there is no flash.

The token *names* in `assistant.css` are identical across both themes and only
their values change — `--pa-navy` means "primary ink" and resolves to a near
white in dark mode. Style new work with the tokens and it themes itself; a
hardcoded colour is the one thing that will break.

## Quick-add grammar

```
draft the Q3 deck tomorrow !        → scheduled tomorrow, promoted to the Big Three
long run friday @sub-90 #health     → scheduled Friday, linked to a matching goal
```

Dates are parsed with chrono-node and stripped from the title. `!` marks a Big
Three item, `@` links a goal, `#` files it to a life area. `Shift+Enter` sends
the raw text to the Inbox instead.

## Architecture

```
app/hq-cstbflbv/
  assistant.css          the .pa-* design kit, scoped under .assistant-shell
  lib/
    types.ts             the domain model + the AssistantData root document
    repo.ts              AssistantRepo interface + localStorage adapter, zod-validated
    store.tsx            AssistantProvider / useAssistant — reducer, persistence, sync
    derive.ts            every rollup and analytic as a pure selector
    dates.ts             local-time day keys ('yyyy-MM-dd'), weeks start Monday
    capitalise.ts        the capital letter at the start of every typed line
    parse.ts seed.ts icons.ts celebrate.ts use-hotkeys.ts
  components/
    assistant-app.tsx    view state (URL hash), first-run screen, palette, hotkeys
    app-header.tsx quick-add.tsx
    shared/              task-row, progress-ring, meter, heatmap, stat-tile, …
    views/               one file per surface
```

**Tooltips.** No `title` attributes: a control that wants one carries
`data-tip="…"` (and `data-tip-key="Esc"` for a keycap), and the single
`TooltipLayer` mounted in `assistant-app.tsx` resolves it with one delegated
listener. Hover and keyboard focus only — never touch. The trigger keeps its
own `aria-label`; the tip itself is `aria-hidden`.

**Brightness.** A hidden dial (long-press the theme toggle, or `Shift + B`)
on a 20–200 scale with 100 meaning untouched. Below neutral a black sheet takes
light away; above it a `backdrop-filter` sheet bends a gamma curve over what is
already painted, reaching ×2 mean luminance on the dark theme at the top. Both
hang off `html` in `assistant.css`, driven by attributes a blocking script in
`layout.tsx` sets before first paint.

Neither is a `filter` on a wrapper — that would create a containing block for
`position: fixed` and kill `backdrop-filter` in the subtree, and this portal is
built out of both. And the lift is a curve rather than `brightness()` because
every CSS shorthand filter is affine in the colour channels, so all of them
clip: the dark theme's own text sits at 0.91 luminance, and a 2× multiply drove
a third of a heading to flat white. The curve is `feComponentTransfer` with an
exponent of 0.7, rendered as an SVG filter in `layout.tsx`; the sheet's
`opacity` cross-fades it against the unfiltered page for the strength in
between.

**Sentence case.** Prose fields run their `onChange` through
`capitaliseOnType(event)` from `lib/capitalise.ts`, which capitalises the first
letter of a line as it is typed — including after a bullet, and not on paste.

**Storage.** One versioned localStorage document under `assistant.data.v1`,
behind the `AssistantRepo` interface. Swapping in a server-backed adapter means
implementing that interface — no component changes. `migrate()` in `repo.ts` is
where future schema versions get handled.

**Data stays in the browser.** Nothing is uploaded. Export/import from the
command palette moves the whole document as JSON.

## Extracting this into its own repo

It is deliberately self-contained: the only imports outside `app/hq-cstbflbv/`
are a handful of shadcn primitives (`dialog`, `command`, `popover`) and the CSS
kit carries its own token block, so it does not depend on the host theme.

1. Copy `app/hq-cstbflbv/` into the new project as a route.
2. Copy the shadcn primitives it imports, or re-point those imports.
3. Ensure the page has a light background — the kit expects to sit on white.

Dependencies used: `motion`, `lucide-react`, `sonner`, `date-fns`,
`chrono-node`, `recharts`, `@dnd-kit/*`, `zod`, `clsx`.

One host coupling is deliberate: the primary action on every surface is the
shared `GlassButton` with `glass-button--haze-light`
(`components/ui/glass-button.tsx`, visuals in `app/style-lab/theme-v2.css`).
That is the app's real "Haze light" control rather than a copy of it, so
extracting this folder means bringing those two along.
