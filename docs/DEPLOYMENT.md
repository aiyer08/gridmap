# Deployment runbook: Supabase + Vercel

This is the second half of `PLAN.md`'s "deploy on localhost first, then set up
Supabase and Vercel." Localhost is done. Everything below is meant to be
copy-pasted; the only judgment calls are the two account names you choose
(Supabase project name, Vercel project name).

Both services are entirely optional at the code level — GridMap runs on
`localStorage` and modelled grid data with zero env vars. This runbook is for
turning those on, not making the app work at all.

**What's verified below, and how:** every claim about Supabase auth flow
behaviour was checked against the installed package (`@supabase/auth-js`
2.112.3, vendored under `node_modules`) and Supabase's current docs (PKCE
flow, implicit flow, redirect URLs, RLS performance guide — fetched August
2026). Every claim about Vercel was checked against Vercel's current docs
(cache-control headers, functions limits/Fluid Compute, cron jobs — fetched
August 2026). Where I couldn't verify something directly, it's marked
**(unverified)** rather than stated as fact.

## Prerequisites

- The repo pushed to a GitHub (or GitLab/Bitbucket) repository — Vercel's
  normal flow imports from git and redeploys on push. You can also deploy
  from the CLI without git, but this runbook assumes git, since that's what
  makes "GitHub Action keeps profiles fresh" (below) work at all.
- A free [Supabase](https://supabase.com/dashboard) account.
- A free [Vercel](https://vercel.com) account.
- Optionally, a free EIA key from
  [eia.gov/opendata/register.php](https://www.eia.gov/opendata/register.php)
  (instant, no approval wait).

---

## Part 1 — Supabase

### 1.1 Create the project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick any name/region/password (the DB password isn't used by the app —
   GridMap only ever talks to Supabase through the anon key + PostgREST).
3. Wait for provisioning (a minute or two).

### 1.2 Apply the schema

Pick one:

**SQL Editor (simplest, no CLI install):**

1. **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](../supabase/schema.sql).
3. **Run.**
4. Confirm: **Table Editor → `logged_actions`** exists and shows the green
   *RLS enabled* badge. If it's missing or the badge is grey/red, re-run the
   script — it's idempotent (`create table if not exists`, `drop policy if
   exists` before every `create policy`), so re-running is always safe.

**Supabase CLI (if you want this reproducible / in version control as a migration):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # from Project Settings → General
mkdir -p supabase/migrations
cp supabase/schema.sql supabase/migrations/00000000000000_init.sql
npx supabase db push
```

If you go this route, treat `supabase/migrations/` as the source of truth
from then on — `db push` diffs against a migration history table it creates
in your database, and editing `schema.sql` by hand afterwards without a new
migration file will make `db push` complain about drift on the next run.

### 1.3 Get the URL and anon key

**Project Settings → API**:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Both are meant to be public — they're `NEXT_PUBLIC_*` on purpose, and the anon
key can only do what Row Level Security allows (see `supabase/schema.sql`).
**Never put the `service_role` key anywhere in this app** — it isn't read by
any code path and would bypass RLS entirely if it leaked to the client.

Put both in `.env.local` for now:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```

### 1.4 Configure auth for magic links

**Authentication → Sign In / Providers → Email**: confirm *Enable email
provider* is on (it is by default).

**Authentication → URL Configuration:**

| Field | Value |
|---|---|
| Site URL | Your production URL once you have it, e.g. `https://gridmap.vercel.app` (`http://localhost:3000` is fine as a placeholder before you deploy) |
| Redirect URLs | `http://localhost:3000/**`, `https://gridmap.vercel.app/**`, and optionally `https://gridmap-*.vercel.app/**` for preview deployments |

**This is the single setting most likely to break sign-in in production.**
Supabase only allows a magic link to redirect to a URL on the **Redirect
URLs** list — anything else (including a real production URL you forgot to
add) silently redirects to the **Site URL** instead. If Site URL is still the
default/localhost value and your production URL isn't in Redirect URLs, every
magic link a real user clicks will land them on `localhost` or nowhere.
This is a dashboard setting, not an env var — changing it takes effect
immediately, no redeploy needed.

**Does this app need an `/auth/callback` route?** No, and here's the exact
reasoning, verified against the installed `@supabase/auth-js`:

- `signInWithOtp` is called with `emailRedirectTo: window.location.origin`
  (`src/lib/track/supabaseClient.ts`) and no `flowType` override, so the
  client uses **implicit flow** — confirmed as the hard-coded default
  (`flowType: 'implicit'`) in `node_modules/@supabase/auth-js/.../GoTrueClient.js`
  for the installed version. This app never imports `@supabase/ssr`'s
  `createBrowserClient`/`createServerClient` (even though `@supabase/ssr` is
  a listed dependency — it appears unused in `src/**`), so none of the
  cookie-based PKCE machinery those helpers set up applies here.
- With implicit flow, the email link returns the session as an **URL hash
  fragment** (`#access_token=...&refresh_token=...`), not a `?code=` query
  param. A hash fragment is never sent to a server, so there is nothing for a
  server-side callback route to receive — the only place this can be handled
  is client-side JS already running in the browser on the page the link lands
  on.
- The client is constructed with `detectSessionInUrl: true`. Per
  `GoTrueClient._initialize()`, this check runs **automatically the moment
  the client is constructed in a browser context** — it's part of the
  constructor's own init chain, not something the app has to trigger.
- `emailRedirectTo` defaults to the bare origin (`/`), and something on that
  page already constructs the client on mount today: `TodayView` →
  `useTracker()` → `createStore()` → `getSession()` → `getSupabase()`. So the
  hash gets consumed automatically on first paint of `/`, without any
  dedicated route.
- If PKCE flow, `@supabase/ssr`, or a different `emailRedirectTo` target that
  doesn't run any Supabase-aware code on mount is introduced later, a
  callback route *would* become necessary. For the record, a minimal PKCE
  callback (for whoever adds it) is: a route handler at `src/app/auth/callback/route.ts`
  that reads `?code=` from the request URL, calls
  `supabase.auth.exchangeCodeForSession(code)` using a server client, and
  redirects to `/`. That is **not needed for the app as it exists today.**

---

## Part 2 — Vercel

### 2.1 Import the project

1. Push the repo to GitHub if it isn't already.
2. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick
   this repo.
3. Framework preset: Next.js, auto-detected. **No `vercel.json` is needed or
   included** — the default build (`next build`) and the default Serverless
   Function behaviour are exactly what this app wants (see the caching notes
   below for why).

### 2.2 Environment variables

Set these in **Project Settings → Environment Variables** (or in the import
screen before the first deploy):

| Variable | Required? | Scope (Environments) | Notes |
|---|---|---|---|
| `EIA_API_KEY` | Optional but recommended | Production, Preview, Development | Server-only, never sent to the browser (`src/lib/env.ts` reads it with plain `process.env`, no `NEXT_PUBLIC_` prefix, and it's only ever read inside server modules under `src/lib/grid`). Without it, every region falls back to the 25 committed modelled/EIA profiles, clearly labelled `"modelled"` where no real data is bundled. |
| `ELECTRICITY_MAPS_TOKEN` | Optional | Same as above | Server-only. |
| `WATTTIME_USERNAME` / `WATTTIME_PASSWORD` | Optional (both or neither) | Same as above | Server-only. Free tier typically covers one region — pick the one this deployment is actually for. |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional (enables accounts) | Every environment where you want sign-in to work | **Client-exposed and inlined at build time.** Adding/changing it requires a new deployment (redeploy, or just push) — it will not take effect on an already-built deployment. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional, pairs with the above | Same scope as `NEXT_PUBLIC_SUPABASE_URL` | Safe to expose; protected by RLS. |

Do **not** add `SUPABASE_SERVICE_ROLE_KEY` — nothing in this app reads it, and
it should never exist in a Vercel project that only needs anon-key access.

If you only set the Supabase vars on **Production**, Preview deployments will
build with accounts disabled (the app degrades to local-only automatically —
see `isSupabaseConfigured()`), which is a reasonable default. Add them to
Preview too if you want PR previews to have working sign-in, and add the
matching `https://<project>-*.vercel.app/**` pattern to Supabase's Redirect
URLs if you do.

### 2.3 Deploy

Click **Deploy**. First build takes a couple of minutes.

### 2.4 Close the loop on the redirect URL

Once you have the real `https://<something>.vercel.app` (or custom domain),
go back to **Supabase → Authentication → URL Configuration** and make sure
that exact URL (with `/**`) is in **Redirect URLs**, and set **Site URL** to
it too. This is a Supabase dashboard change, not a Vercel env var — it takes
effect immediately, no redeploy required.

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
   are correct, just different configurations.
4. **Log an action** (run a shift or a habit from the UI). It should appear
   in the impact/history view immediately (this is optimistic — it updates
   before the network call resolves).
5. **Sign in.** Go to `/impact`, enter an email you can access, submit. Check
   the inbox for the magic link email and confirm it points at your
   production domain, not `localhost`. Click it.
6. **Confirm local history migrated.** After the redirect back to the app,
   you should land signed-in, and the action you logged in step 4 (while
   anonymous) should still be present. If you want to check the raw rows,
   Supabase → **Table Editor → `logged_actions`** should show them with your
   `user_id`.
7. **Sign in as a second email** and confirm it sees an empty history, not
   the first account's rows — this is the actual RLS guarantee, not just
   "sign-in works."

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
docs if the count matters to you — **(unverified exact current number)**). But
the thing that needs to change is the **files committed to the repo**, which only exist
inside a specific build's output. A Vercel Function's filesystem is
read-only except `/tmp` (ephemeral, private to one invocation, gone after
it ends), and a Function has no way to `git commit`/push. A cron-triggered
route could at best re-warm the in-memory/disk cache tiers that
`profileStore.ts` already manages on its own per-request TTL — which makes it
redundant, not additive. **Don't build this**; it would give the appearance
of a fix while doing nothing for the actual staleness of the bundled files.

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

**Magic link email points at `localhost` (or a blank/unreachable page) in
production.**
Cause: the link's destination wasn't on Supabase's **Redirect URLs** allow-list,
so Supabase fell back to **Site URL**, which is still the local dev default.
Fix: Supabase → Authentication → URL Configuration → add your exact
production URL (`https://your-app.vercel.app/**`) to Redirect URLs, and set
Site URL to it too. This takes effect immediately — no redeploy needed. The
allow-list is checked when the link is clicked, not when the email was sent,
so in principle an already-sent link should start working once you fix the
config — but requesting a fresh link is the simplest way to confirm the fix
actually took.

**RLS blocks inserts (`new row violates row-level security policy`, or writes
silently do nothing).**
Most likely causes, roughly in order of likelihood:
1. `schema.sql` was only partially applied — check **Table Editor →
   `logged_actions`** for the green *RLS enabled* badge, and run
   `select policyname from pg_policies where tablename = 'logged_actions';`
   in the SQL editor — you should see all four (`own rows: select/insert/update/delete`).
   Re-run `schema.sql` if any are missing; it's idempotent.
2. The write happened while the session was `null` — e.g. a stale tab that
   was signed in, got signed out in another tab, and didn't pick that up
   yet. `supabaseStore.ts`'s `requireContext()` already throws before
   attempting the write in this case, so this shows up as a caught error in
   the UI ("That didn't save"), not a silent RLS failure. If you're seeing an
   actual Postgres RLS error, check that the row being inserted has
   `user_id` equal to the signed-in user's `auth.uid()` — `supabaseStore.ts`
   sets this explicitly per insert, so a mismatch would indicate a bug in
   that code path, not a config issue.
3. Verifying RLS is working correctly (not blocking too much *or* too
   little): sign in as two different emails in two browsers/incognito
   windows and confirm each only ever sees their own rows in the UI. The SQL
   editor itself bypasses RLS (it runs with elevated privileges), so seeing
   multiple users' rows there is expected and not a leak.

**No `EIA_API_KEY` set, and the app is only showing "modelled" data.**
This is the designed fallback, not a bug. Confirm intentionally by checking
`/api/grid`'s JSON response: `providers` will show the `eia` entry with
`"used": false` and a detail like `"Needs an EIA API key."`, and a `fallback`
provider with `"used": true`. `notes` will include "These numbers are a
modelled estimate for a grid like yours, not a measurement." If you meant to
have real data, double check `EIA_API_KEY` is set for the right Vercel
environment (Production vs Preview) and that you redeployed after adding it —
unlike the `NEXT_PUBLIC_*` Supabase vars, this one is read at request time on
the server, not inlined at build time, so it *shouldn't* need a redeploy, but
Vercel only injects env vars that existed at the time a deployment was
created either way — if in doubt, trigger a fresh deploy.

**Profile cache directory can't be written to.**
Expected on Vercel — see "Caching and the filesystem on Vercel" above. This
is not an error state; there's nothing to fix. If you see `EROFS` or similar
in Vercel's function logs, it's from the try/catch in `profileStore.ts`'s
`fsModule()`/`writeDiskCache()`, and the catch block is doing exactly its job
(the app keeps working from memory/bundled profiles). Confirm nothing is
actually broken by checking the `/api/grid` response still returns
`"ok": true` with a real `snapshot`.
