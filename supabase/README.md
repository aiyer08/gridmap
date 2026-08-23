# Supabase (optional)

GridMap works fully without Supabase — the tracker falls back to `localStorage`,
and nothing in the UI breaks. Supabase only adds one thing: your history follows
you to another device.

## Apply the schema

1. Create a project at <https://supabase.com/dashboard> (free tier is plenty).
2. Open **SQL Editor → New query**, paste all of [`schema.sql`](./schema.sql),
   and hit **Run**. It's idempotent, so re-running after an edit is fine.
3. Check **Table Editor → `logged_actions`** exists and shows the green
   *RLS enabled* badge. If it doesn't, the policies at the bottom of the file
   didn't run — without them nobody can read or write anything.

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
- **Authentication → URL Configuration → Site URL**: `http://localhost:3000`
  locally, your Vercel URL in production. Add both to *Redirect URLs* so the
  link in the email is accepted from either.

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
