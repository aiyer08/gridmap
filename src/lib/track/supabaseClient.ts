/**
 * Browser Supabase client and the small auth surface the UI is allowed to use.
 *
 * Supabase is entirely optional in GridMap: with no keys set, this module
 * answers "not configured" and nothing else here ever runs. Two deliberate
 * choices make that true:
 *
 * 1. `@supabase/supabase-js` is imported *dynamically*, and only after the env
 *    check passes — so a deployment without accounts never ships the client
 *    chunk to the browser. The static import is type-only, which erases.
 * 2. The client is built lazily. A module-level `createClient("")` throws, which
 *    would break a page that doesn't even use accounts.
 *
 * The UI imports these wrappers rather than `@supabase/supabase-js` directly,
 * so swapping the backend later is a one-file change.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read statically so Next can inline the values into the client bundle
 * (`process.env[name]` would not be replaced). Blank counts as absent, because
 * `.env.example` ships these keys with empty values.
 */
function clean(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function supabaseUrl(): string | null {
  return clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function supabaseAnonKey(): string | null {
  return clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** True only when both halves are present. Everything else checks this first. */
export function isSupabaseConfigured(): boolean {
  return supabaseUrl() !== null && supabaseAnonKey() !== null;
}

let clientPromise: Promise<SupabaseClient | null> | null = null;

/** The shared browser client, or null when Supabase isn't configured. */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return Promise.resolve(null);
  clientPromise ??= (async () => {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(supabaseUrl()!, supabaseAnonKey()!, {
        auth: {
          // Magic-link sign-in lands back on the app with tokens in the URL.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    } catch {
      // A malformed URL or a failed chunk load shouldn't be fatal — the app
      // just stays local-only.
      return null;
    }
  })();
  return clientPromise;
}

/** What the UI needs to know about who's signed in. Nothing more. */
export interface TrackerSession {
  userId: string;
  email?: string;
}

export async function getSession(): Promise<TrackerSession | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;
    return {
      userId: data.session.user.id,
      email: data.session.user.email ?? undefined,
    };
  } catch {
    return null;
  }
}

export interface AuthResult {
  ok: boolean;
  /** Plain-English problem, safe to show the user. */
  error?: string;
}

/**
 * Magic link. No passwords to forget, and no password-reset flow to build —
 * a CO2 tracker isn't worth either of those.
 */
export async function signInWithOtp(
  email: string,
  redirectTo?: string,
): Promise<AuthResult> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "Accounts aren't set up on this deployment." };
  const address = email.trim();
  if (!address.includes("@")) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo:
          redirectTo ?? (typeof window !== "undefined" ? window.location.origin : undefined),
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the sign-in service. Try again in a moment." };
  }
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // Already gone, as far as the user is concerned.
  }
}

/**
 * Subscribe to sign-in/sign-out. Returns an unsubscribe function immediately
 * (rather than a promise) so it drops straight into a `useEffect` cleanup, even
 * though the client itself is still loading underneath.
 */
export function onAuthStateChange(
  listener: (session: TrackerSession | null) => void,
): () => void {
  let cancelled = false;
  let unsubscribe = () => {};

  void getSupabase().then((supabase) => {
    if (!supabase || cancelled) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      listener(
        session ? { userId: session.user.id, email: session.user.email ?? undefined } : null,
      );
    });
    unsubscribe = () => data.subscription.unsubscribe();
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
