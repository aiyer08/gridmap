/**
 * Supabase-backed tracker store, scoped to the signed-in user.
 *
 * Row-level security (see `supabase/schema.sql`) is what actually enforces the
 * scoping — the `user_id` filters here are belt-and-braces so a policy change
 * can never quietly widen what a query returns.
 */

import type { LoggedAction } from "@/lib/types";
import { materialise, type LogInput, type TrackerStore } from "./store";
import { getSupabase } from "./supabaseClient";

const TABLE = "logged_actions";

/** The database shape. Snake_case on the wire, camelCase in the app. */
interface LoggedActionRow {
  id: string;
  user_id: string;
  kind: string;
  subject_id: string;
  label: string | null;
  logged_at: string;
  grams_saved: number | string | null;
  baseline_grams: number | string | null;
  actual_grams: number | string | null;
  status: string;
  region_ba: string | null;
}

/** PostgREST can serialise `numeric` as a string, so never trust the type. */
function num(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fromRow(row: LoggedActionRow): LoggedAction {
  const status: LoggedAction["status"] = row.status === "declined" ? "declined" : "done";
  return {
    id: row.id,
    kind: row.kind === "habit" ? "habit" : "shift",
    subjectId: row.subject_id,
    label: row.label ?? row.subject_id,
    loggedAt: row.logged_at,
    gramsSaved: status === "declined" ? 0 : Math.max(0, num(row.grams_saved) ?? 0),
    baselineGrams: num(row.baseline_grams),
    actualGrams: num(row.actual_grams),
    status,
    regionBa: row.region_ba ?? undefined,
  };
}

function toRow(action: LoggedAction, userId: string): Record<string, unknown> {
  return {
    id: action.id,
    user_id: userId,
    kind: action.kind,
    subject_id: action.subjectId,
    label: action.label,
    logged_at: action.loggedAt,
    grams_saved: action.gramsSaved,
    baseline_grams: action.baselineGrams ?? null,
    actual_grams: action.actualGrams ?? null,
    status: action.status,
    region_ba: action.regionBa ?? null,
  };
}

async function requireContext() {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase isn't configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("You need to be signed in to sync your tracker.");
  return { supabase, userId: data.session.user.id };
}

export const supabaseStore: TrackerStore = {
  async list(): Promise<LoggedAction[]> {
    const { supabase, userId } = await requireContext();
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("logged_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as LoggedActionRow[]).map(fromRow);
  },

  async log(input: LogInput): Promise<LoggedAction> {
    const { supabase, userId } = await requireContext();
    // The id is minted client-side so an optimistic UI can reference the row
    // before the round-trip finishes — and so a later migration can dedupe.
    const action = materialise(input);
    const { data, error } = await supabase
      .from(TABLE)
      .insert(toRow(action, userId))
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data ? fromRow(data as LoggedActionRow) : action;
  },

  async remove(id: string): Promise<void> {
    const { supabase, userId } = await requireContext();
    const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error(error.message);
  },

  async clear(): Promise<void> {
    const { supabase, userId } = await requireContext();
    const { error } = await supabase.from(TABLE).delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
  },
};

export interface MigrationResult {
  imported: number;
  /** Rows that were already there — the reason this is safe to run repeatedly. */
  skipped: number;
}

/**
 * Carry an anonymous history into an account.
 *
 * Someone can use GridMap for weeks before deciding to sign in, and losing that
 * total at the moment they commit to the app would be the worst possible
 * message to send. Deduplication is by natural key (kind + subject + exact
 * timestamp + status) as well as id, so running this on every sign-in — which
 * is exactly what the hook does — imports each row once.
 *
 * Local rows are left in place: they're the offline copy if the network drops,
 * and the hook stops reading them once the Supabase store is active.
 */
export async function migrateLocalToSupabase(
  local: TrackerStore,
  remote: TrackerStore,
): Promise<MigrationResult> {
  const localActions = await local.list();
  if (localActions.length === 0) return { imported: 0, skipped: 0 };

  const remoteActions = await remote.list();
  const seen = new Set<string>();
  for (const action of remoteActions) {
    seen.add(action.id);
    seen.add(naturalKey(action));
  }

  let imported = 0;
  let skipped = 0;
  // Oldest first, so the remote ordering matches the order things happened.
  for (const action of [...localActions].reverse()) {
    if (seen.has(action.id) || seen.has(naturalKey(action))) {
      skipped += 1;
      continue;
    }
    await remote.log(action);
    seen.add(naturalKey(action));
    imported += 1;
  }
  return { imported, skipped };
}

function naturalKey(action: LoggedAction): string {
  return `${action.kind}|${action.subjectId}|${action.loggedAt}|${action.status}`;
}
