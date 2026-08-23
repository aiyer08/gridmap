# Supabase (optional)

GridMap works fully without Supabase — the tracker falls back to `localStorage`,
and nothing in the UI breaks. Supabase only adds one thing: your history follows
you to another device.

This file is the quick local reference. For the full first-deploy runbook
(Supabase + Vercel together, env var scopes, smoke test, troubleshooting) see
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Apply the schema

1. Create a project at <https://supabase.com/dashboard> (free tier is plenty).
2. Open **SQL Editor → New query**, paste all of [`schema.sql`](./schema.sql),
   and hit **Run**. It's idempotent, so re-running after an edit is fine.
3. Check **Table Editor → `logged_actions`** exists and shows the green
   *RLS enabled* badge. If it doesn't, the policies at the bottom of the file
   didn't run — without them nobody can read or write anything.

   CLI alternative: `supabase link --project-ref <ref>`, copy `schema.sql`
   into `supabase/migrations/00000000000000_init.sql`, then `supabase db push`.
   Once you adopt migrations, make future schema edits as new migration files
   rather than re-editing this one — `db push` diffs against migration
   history, and hand edits to a database that's ahead of it will conflict.
   The SQL Editor path above doesn't have that constraint, which is why it's
   listed first.

## Set the env vars

From **Project Settings → API**, copy the *Project URL* and the *anon public*
key into `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```

Both are `NEXT_PUBLIC_*` on purpose: they ship to the browser, which is safe
because the anon key can only do what row-level security allows. Never put the
`service_role` key in this app.

Restart `next dev` after editing `.env.local` — env vars are inlined at build
time. Set the same two variables in Vercel (**Settings → Environment
Variables**) when you deploy.

## Sign-in

Auth is magic link only (`signInWithOtp`), so there are no passwords to store.

- **Authentication → Providers → Email** must have *Enable email provider* on.
- **Authentication → URL Configuration → Site URL**: your production URL
  (e.g. `https://gridmap.vercel.app`). This is the fallback destination, and
  what gets used if a `redirectTo` isn't on the allow-list below.
- **Authentication → URL Configuration → Redirect URLs**: add every origin
  the app can be opened from, as exact URLs or globs —
  `http://localhost:3000/**` for local dev, `https://gridmap.vercel.app/**`
  for production, and `https://gridmap-*.vercel.app/**` if you also want
  magic links to work from preview deployments. **A link whose destination
  isn't on this list gets sent to the Site URL instead** — the #1 cause of
  "the email link goes to localhost/nowhere in production."

**No `/auth/callback` route is needed.** `signInWithOtp` here uses the
implicit flow (the `@supabase/supabase-js` default — `flowType` is never set
to `'pkce'` in `supabaseClient.ts`), so the email link returns with the
session tokens in the URL *hash* (`#access_token=...`), not a `?code=`. The
client is created with `detectSessionInUrl: true`, and `GoTrueClient` consumes
that hash automatically the moment the client is constructed in the browser —
no page-specific handling required. That construction already happens on
first paint of `/` (`TodayView` → `useTracker` → `createStore()` →
`getSession()`) and on `/impact` (`useSession`), which is why
`emailRedirectTo: window.location.origin` (the bare origin, `/`) works today.
If a future change made the landing page not call any tracker/auth code on
mount, the tokens would sit unconsumed in the URL until something did — worth
re-checking if sign-in ever seems to silently do nothing.

## What happens to local history

Sign in after logging anonymously and `migrateLocalToSupabase()` copies those
rows up on first sync. It dedupes on kind + subject + timestamp + status, so
signing in repeatedly never double-counts. The local copy is left alone as an
offline fallback.

## Verifying RLS

Sign in as two different emails and confirm each only sees their own rows. A
quick check from the SQL editor:

```sql
select user_id, count(*) from public.logged_actions group by 1;
```

The SQL editor bypasses RLS (it runs as a superuser), so that query showing
multiple users is expected — the guarantee is about the anon-key path the
browser uses.
