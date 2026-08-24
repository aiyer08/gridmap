# Deployment runbook: Vercel

This is the second half of `PLAN.md`'s "deploy on localhost first, then set up
Vercel." Localhost is done. Everything below is meant to be copy-pasted; the
only judgment call is the Vercel project name.

**There is no database and no accounts.** GridMap logs impact history to the
browser's `localStorage` only (see `src/lib/track/store.ts` and the
`StorageNotice` card on `/impact`) — that was a deliberate product decision,
not a placeholder for Supabase or anything else. The only real secret in this
app is the EIA key, and even that is optional: with zero env vars set, GridMap
serves modelled grid profiles and still works end to end.

**What's verified below, and how:** every claim about Vercel was checked
against Vercel's current docs (cache-control headers, functions
limits/Fluid Compute, cron jobs — fetched August 2026). The Electricity Maps
and WattTime behaviour below reflects a live, credentialed test against both
APIs on 2026-08-23, not just their docs. Where something couldn't be verified
directly, it's marked **(unverified)** rather than stated as fact.

## Prerequisites

- The repo pushed to a GitHub (or GitLab/Bitbucket) repository — Vercel's
  normal flow imports from git and redeploys on push. You can also deploy
  from the CLI without git, but this runbook assumes git, since that's what
  makes "GitHub Action keeps profiles fresh" (below) work at all.
- A free [Vercel](https://vercel.com) account.
- Optionally, a free EIA key from
  [eia.gov/opendata/register.php](https://www.eia.gov/opendata/register.php)
  (instant, no approval wait).

---

## Deploy

### 1. Import the project

1. Push the repo to GitHub if it isn't already.
2. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick
   this repo.
3. Framework preset: Next.js, auto-detected. **No `vercel.json` is needed or
   included** — the default build (`next build`) and the default Serverless
   Function behaviour are exactly what this app wants (see the caching notes
   below for why).

### 2. Environment variables

Set these in **Project Settings → Environment Variables** (or in the import
screen before the first deploy). All of them are optional — an empty
`.env.local`/no env vars at all is a fully supported deployment, just one
running on modelled data instead of measured data.

| Variable | Required? | Scope (Environments) | Notes |
|---|---|---|---|
| `EIA_API_KEY` | Optional but recommended | Production, Preview, Development | Server-only — read via plain `process.env` in `src/lib/env.ts`, no `NEXT_PUBLIC_` prefix, and only ever touched inside server modules under `src/lib/grid`. Without it, every region falls back to the 25 committed EIA/modelled profiles, clearly labelled `"modelled"` where no real data is bundled. |
| `ELECTRICITY_MAPS_TOKEN` | Optional | Production, Preview, Development | Server-only. Confirmed working live (2026-08-23): `GET /v3/carbon-intensity/latest?zone=US-CAL-CISO` returned `carbonIntensity: 158` with `emissionFactorType: "lifecycle"` (matches this app's own basis), `/v3/carbon-intensity/forecast` returned 25 hourly points, `/v3/power-breakdown/latest` returned a full per-fuel breakdown. This is what upgrades the current hour from a nowcast to an actual live measurement, and adds a real ~24h forecast on top of the climatology. Get a token at [portal.electricitymaps.com](https://portal.electricitymaps.com/). |
| `WATTTIME_USERNAME` + `WATTTIME_PASSWORD` | Optional, set as a pair | Production, Preview, Development | Server-only. **The durable way to use WattTime** — the app exchanges these for a fresh bearer token on every request (`GET /login` with HTTP Basic), so there's nothing to expire. Preferred over `WATTTIME_API_TOKEN` whenever both are set (`src/lib/env.ts`'s `wattTimeCredentials()`). |
| `WATTTIME_API_TOKEN` | Optional, alternative to the pair above | Production, Preview, Development | **Read the warning below before using this alone.** A raw bearer token issued by WattTime's own portal. Verified from the JWT's own `iat`/`exp` claims: it expires **exactly 1800 seconds (30 minutes) after issue.** A token-only deployment works once, then silently falls back to the model with no error surfaced to the user (`fetchWattTime` in `src/lib/grid/wattTime.ts` detects the expiry and returns an honest `attribution.detail`, but nothing loud). Use the username/password pair instead unless you're doing a five-minute manual test. |
| `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_*` | **Do not set — not used** | — | GridMap has no database and no accounts. There is nothing to configure here; if you see these mentioned in old docs or git history, they're stale (this app briefly had an optional Supabase-backed account sync, since removed). |

**On WattTime specifically:** the credentialed test account's token carries
`co2_moer` data for `CAISO_NORTH` only, which matches WattTime's documented
free-tier entitlement of **one grid region**. It benefits users physically on
that grid (Northern California, roughly) and does nothing for anyone else —
`fetchWattTime` returns an honest "no region mapped" attribution for any BA
it isn't entitled to rather than failing. If you're deploying for a
different region, WattTime may simply never contribute data, which is
correct behaviour, not a misconfiguration.

Also worth knowing: WattTime reports **marginal** emissions (the CO2 of the
next kWh) in `lbs_co2_per_mwh`, converted in code via
`LBS_PER_MWH_TO_G_PER_KWH = 0.45359237` to gCO2/kWh. EIA and Electricity Maps
both report **average** intensity — a different quantity. `buildSnapshot`
deliberately never blends WattTime's number into the main series; it only
ever appears as an independent cross-check (`cleanlinessPercentile` /
`signal-index`, inverted so 100 = cleanest to match this app's convention).
If you're auditing the code for correctness, "WattTime's number doesn't
match the headline number" is by design, not a bug.

### 3. Deploy

Click **Deploy**. First build takes a couple of minutes.

---

## Post-deploy smoke test

Run through this on the actual deployed URL, not localhost:

1. **Load `/`.** Should render the today view with a default/last-used
   region, no console errors.
2. **Enter a ZIP code** for a region you know (try your own). Confirm the
   page updates to a city name and a new forecast.
3. **Confirm `/api/grid` is real.** Open browser dev tools → Network, find
   the `/api/grid?zip=...` request, check the response: `"ok": true`,
   `snapshot.series` has ~168 hourly points, and `snapshot.providers` lists
   `eia` with `"used": true` if you set `EIA_API_KEY`, or `"used": false` with
   a `fallback`/`modelled` provider marked `used: true` if you didn't — both
   are correct, just different configurations. If `ELECTRICITY_MAPS_TOKEN` is
   set, the `electricity-maps` provider should show `"used": true` too.
4. **Log an action** (run a shift or a habit from the UI). It should appear
   in the impact/history view immediately (this is optimistic — it updates
   before anything else happens) and should still be there after a page
   reload (it's in `localStorage`, so this is the entire persistence test —
   there's no server round trip to also check).
5. **Reload `/impact`** and confirm the `StorageNotice` card explains the
   no-account, local-only design rather than showing a sign-in prompt.

---

## Keeping grid profiles fresh

`src/lib/grid/data/profiles/*.json` are committed, pre-built EIA profiles (25
balancing authorities today, via `npm run build:profiles`). They're what
makes the common case a zero-network lookup, but they're a snapshot — the
grid's seasonal shape drifts over weeks. Three options, in the order I'd
reach for them:

### Option A — manual re-run (recommended to start)

```bash
npm run build:profiles
git diff --stat src/lib/grid/data/profiles/   # review what changed
git add src/lib/grid/data/profiles/
git commit -m "Refresh grid profiles"
git push   # Vercel's git integration redeploys automatically
```

**Why this is fine, not lazy:** the app already self-heals staleness at
runtime. `profileStore.ts` checks each bundled profile's age and, once it's
older than 7 days *and* `EIA_API_KEY` is set in the deployment, kicks off a
background fetch of fresh EIA history and serves that from memory for the
rest of that server instance's life — the user never sees an error, and the
answer quietly gets better. Re-running the build script monthly-ish (or
whenever `snapshot.notes` starts mentioning staleness) is enough; there is no
correctness cliff if you forget for a while.

**Tradeoff:** relies on a human remembering. Fine for a small-team project.

### Option B — GitHub Action on a schedule

A workflow like:

```yaml
on:
  schedule:
    - cron: "0 6 1 * *"   # monthly
  workflow_dispatch: {}
jobs:
  refresh-profiles:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build:profiles
        env:
          EIA_API_KEY: ${{ secrets.EIA_API_KEY }}
      - run: |
          git config user.name "gridmap-bot"
          git config user.email "actions@users.noreply.github.com"
          git add src/lib/grid/data/profiles/
          git diff --cached --quiet || git commit -m "Scheduled profile refresh"
          git push
```

**Tradeoffs:**

- `EIA_API_KEY` has to be duplicated as a GitHub Actions secret — same value
  as the one in Vercel, but a second place to manage and rotate.
- A push straight to `main` needs `contents: write` on the workflow's token;
  if the repo has branch protection requiring review, push a branch and open
  a PR instead (`peter-evans/create-pull-request` is the common action for
  this) and have someone merge it, which then triggers the Vercel deploy.
- Building all 25 BAs takes on the order of 10 minutes (≈20s each); well
  within GitHub Actions' free minutes for a monthly job.
- This is genuinely hands-off once set up, which is the whole point.

### Option C — Vercel Cron hitting a route: not viable for this, and here's why

It's tempting because Vercel Cron is already there and free (the Hobby plan
allows cron jobs but caps them to running once/day; exact per-project job
count has changed more than once in 2026, so check Vercel's current cron
docs if the count matters to you — **(unverified exact current number)**).
But the thing that needs to change is the **files committed to the repo**,
which only exist inside a specific build's output. A Vercel Function's
filesystem is read-only except `/tmp` (ephemeral, private to one invocation,
gone after it ends), and a Function has no way to `git commit`/push. A
cron-triggered route could at best re-warm the in-memory/disk cache tiers
that `profileStore.ts` already manages on its own per-request TTL — which
makes it redundant, not additive. **Don't build this**; it would give the
appearance of a fix while doing nothing for the actual staleness of the
bundled files.

**Recommendation:** start with Option A. Move to Option B only once the
manual step has actually been forgotten a few times — it's more moving parts
(a second secret, a bot committer, potentially a PR flow) for a problem the
app already degrades gracefully from.

---

## Caching and the filesystem on Vercel

Things worth understanding rather than just trusting, since this is exactly
where "works on localhost" and "works on Vercel" can quietly diverge:

**`EIA_API_KEY` does not leak to the client.** Confirmed by reading
`src/lib/env.ts` (plain `process.env`, no `NEXT_PUBLIC_` prefix) and every
call site under `src/lib/grid` — all server-only modules, never imported from
a `"use client"` file. Nothing to change here.

**`/api/grid`'s `cache-control: public, s-maxage=900, stale-while-revalidate=3600`
does what it's meant to, and `export const dynamic = "force-dynamic"` doesn't
fight it.** These are two independent layers on Vercel: `force-dynamic` tells
*Next.js* not to try to statically render or ISR this route at build time —
the Function runs fresh on every invocation Vercel decides to make. Separately,
Vercel's Edge Network reads the `Cache-Control` response header from that
Function's output and caches *the output* at the edge for `s-maxage` seconds,
serving stale-but-revalidating for the `stale-while-revalidate` window after
that — independent of whether Next.js itself would have cached anything. This
is confirmed directly in Vercel's docs. One cosmetic detail: because this
route sets only `Cache-Control` (no `CDN-Cache-Control`/`Vercel-CDN-Cache-Control`),
Vercel's edge strips the `s-maxage`/`stale-while-revalidate` directives before
forwarding the response to the browser — the CDN still honors them
internally, the browser just doesn't see them in dev tools. That's expected
and not worth "fixing" by adding the other headers unless you also want to
tune caching on some other CDN in front of Vercel.

**The disk cache degrades to memory-only, and that's already handled.**
`.cache/grid-profiles/` (`profileStore.ts`) is written with `fs.writeFile`
wrapped in try/catch, and read with the same — a read-only filesystem (which
is what Vercel Functions have outside `/tmp`) makes every write fail silently
and every read return nothing, and the code already falls through to the
in-memory `Map` cache. No code change needed for correctness. The
**consequence**, worth knowing rather than fixing: on Vercel, that in-memory
cache only lives as long as one warm Function instance. A cold start (new
instance, which Vercel spins up and recycles on its own schedule) starts
empty, so it re-resolves from the committed `data/profiles/*.json` (still
instant, zero network, for any of the 25 bundled BAs) or, for a region not in
that bundle, re-fetches ~90 days from EIA on that cold start rather than
reusing a persisted cache. That's more EIA calls over time than a
long-running server would make, but well inside EIA's free-tier limits for a
personal-scale app, and it never surfaces as a user-visible error — the code
already treats every filesystem operation here as best-effort.

**Fire-and-forget background upgrades may not finish, and that's already
accounted for.** When a bundled profile is stale (>7 days) or a live fetch
succeeds on the cold path, `profileStore.ts` schedules a full-year rebuild via
an un-awaited promise (`scheduleUpgrade`), explicitly commented in the source
as "can be cut short when a serverless invocation ends... acceptable because
the next request simply tries again." On Vercel, a Function's execution can
end once the response is sent unless the work is wrapped in something like
`waitUntil()` from `@vercel/functions`, which this code doesn't use. This
means the background upgrade is best-effort and may frequently not complete —
which is fine, since the user already got a good, real answer before that
promise was even started, and it costs nothing to retry on the next request.
Function *duration* itself is not a concern: Vercel's Hobby plan defaults to
Fluid Compute with a 300s max duration, comfortably above this route's
internal ~12s cold-path budget.

---

## Troubleshooting

**No `EIA_API_KEY` set, and the app is only showing "modelled" data.**
This is the designed fallback, not a bug. Confirm intentionally by checking
`/api/grid`'s JSON response: `providers` will show the `eia` entry with
`"used": false` and a detail like `"Needs an EIA API key."`, and a `fallback`
provider with `"used": true`. `notes` will include "These numbers are a
modelled estimate for a grid like yours, not a measurement." If you meant to
have real data, double check `EIA_API_KEY` is set for the right Vercel
environment (Production vs Preview) and that you redeployed after adding it —
this one is read at request time on the server, not inlined at build time, so
it *shouldn't* need a redeploy, but Vercel only injects env vars that existed
at the time a deployment was created either way — if in doubt, trigger a
fresh deploy.

**`WATTTIME_API_TOKEN` worked once, then stopped.**
Expected — see the warning in the env var table above. The token expired (30
minutes after issue). Either request a fresh one each time you need a manual
check, or switch to `WATTTIME_USERNAME` + `WATTTIME_PASSWORD` so the app can
mint its own tokens indefinitely. Check `/api/grid`'s `providers` array for
the `watttime` entry's `detail` field — `fetchWattTime` reports the expiry
explicitly ("The WattTime token has expired — they last 30 minutes...")
rather than a generic failure.

**WattTime shows `"used": false` / "no region mapped" even though credentials
are set correctly.**
Likely not a bug: WattTime's free tier is entitled to one grid region, and
`src/lib/grid/wattTime.ts`'s `WATTTIME_REGIONS` table only has a mapping for
BAs it can guess at — if your account's actual entitlement is a different
region than the one this deployment serves, there's genuinely nothing for it
to return. Check `GET /v3/my-access` on WattTime's API with your credentials
to see what your account is actually entitled to.

**Profile cache directory can't be written to.**
Expected on Vercel — see "Caching and the filesystem on Vercel" above. This
is not an error state; there's nothing to fix. If you see `EROFS` or similar
in Vercel's function logs, it's from the try/catch in `profileStore.ts`'s
`fsModule()`/`writeDiskCache()`, and the catch block is doing exactly its job
(the app keeps working from memory/bundled profiles). Confirm nothing is
actually broken by checking the `/api/grid` response still returns
`"ok": true` with a real `snapshot`.
