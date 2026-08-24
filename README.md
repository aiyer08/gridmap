# GridMap

GridMap shows how clean your local electricity grid is right now and over the
next seven days, so you can choose when to run a dishwasher, dryer, or EV
charger. The grid's fuel mix changes hour to hour — solar peaks midday, gas
plants pick up the evening ramp — so the same appliance run can produce
several times more or less CO2 depending on when you start it.

![GridMap screenshot placeholder](docs/screenshot.png)

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. That's it — **GridMap runs with zero API keys.**
With no `EIA_API_KEY` set, it serves modelled grid profiles (physically
plausible archetypes, clearly labelled as modelled) instead of measured data,
so the app is fully usable with an empty `.env.local`.

To see real data for your own region, add a free key from
[eia.gov/opendata/register.php](https://www.eia.gov/opendata/register.php) to
`EIA_API_KEY` in `.env.local` and restart `npm run dev`. Env vars are read at
build/start time, so the dev server needs a restart after editing them.

Two more optional keys sharpen the current-hour reading beyond what the EIA's
~half-day-old fuel-mix data can do on its own:

- **Electricity Maps** (`ELECTRICITY_MAPS_TOKEN`) — a live, minute-by-minute
  intensity reading and a ~24h forecast. Get one at
  [portal.electricitymaps.com](https://portal.electricitymaps.com/).
- **WattTime** (`WATTTIME_USERNAME` / `WATTTIME_PASSWORD`) — an independent
  cleanliness percentile, shown as a cross-check rather than blended into the
  forecast. Get credentials at [docs.watttime.org](https://docs.watttime.org/).
  Its free tier typically only covers **one** grid region, so pick the one
  you actually live in.

None of these are required, and the app tells you in the UI which of them
it's actually using for a given answer.

There are no accounts, and that's intentional rather than a missing feature.
Everything you log is saved to the browser's `localStorage` and never sent
anywhere — no sign-up, no email, no database of household energy habits to
look after. The tradeoff is the obvious one: clearing browser data clears
your history, and GridMap on your phone starts a fresh tally from GridMap on
your laptop. `src/lib/track/store.ts` is the one place that decision lives,
and it's written so a synced backend could be added later without the UI
changing.

## Project layout

```
src/app/                  Next.js App Router pages (/, /impact, /tips) and the one API route
src/app/api/grid/         GET /api/grid — the only dynamic route; calls the EIA API server-side
src/components/app/       The main UI: today's forecast, appliance picker, run-window suggestions
src/components/auth/      SignInCard and the session hook (Supabase magic link)
src/components/charts/    The intensity/CO2 charts
src/components/ui/        Shared primitives (buttons, cards, toasts, theme)
src/lib/grid/             Grid intensity: EIA/Electricity Maps/WattTime clients, climatology,
                          the tiered profile resolver, and 25 pre-built regional profiles
                          under data/profiles/ (npm run build:profiles regenerates these)
src/lib/track/            The tracker's storage layer — localStorage and Supabase implementations
                          behind one interface, plus the useTracker hook the UI calls
src/lib/region/           ZIP -> balancing authority resolution
supabase/                 schema.sql (one table, RLS-scoped) and setup notes
scripts/build-profiles.ts Rebuilds the committed EIA profiles in src/lib/grid/data/profiles/
docs/                     METHODOLOGY.md (the science) and DEPLOYMENT.md (Supabase + Vercel runbook)
```

## Scripts

| Command                | What it does                                                          |
| ----------------------- | ---------------------------------------------------------------------- |
| `npm run dev`           | Local dev server with hot reload.                                     |
| `npm run build`         | Production build (also what Vercel runs).                             |
| `npm test`              | Runs the test suite once (Vitest).                                    |
| `npm run test:watch`    | Same, in watch mode.                                                   |
| `npm run build:profiles`| Rebuilds the committed grid profiles in `src/lib/grid/data/profiles/` from a year of EIA history. Needs `EIA_API_KEY`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#keeping-grid-profiles-fresh) for how to keep these from going stale in production. |
| `npm run lint`          | ESLint.                                                                |
| `npm start`             | Serves a production build (`next build` first).                       |

## Learn more

- [docs/METHODOLOGY.md](docs/METHODOLOGY.md) — where the numbers come from: the
  EIA climatology, the demand nowcast, how Electricity Maps and WattTime are
  blended in (or deliberately not), and the confidence labelling.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — the runbook for standing up
  Supabase and deploying to Vercel, including a post-deploy smoke test and
  troubleshooting for the failures that actually happen.
