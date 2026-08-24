/**
 * The tracker's storage contract.
 *
 * Anonymous users keep their history in `localStorage`; signed-in users keep it
 * in Supabase. Neither the hook nor the UI should care which — they get a
 * `TrackerStore` and a label saying where it lives.
 */

import type { LoggedAction } from "@/lib/types";

/** What a caller supplies when logging: everything except the bookkeeping. */
export type LogInput = Omit<LoggedAction, "id" | "loggedAt"> & { loggedAt?: string };

export interface TrackerStore {
  list(): Promise<LoggedAction[]>;
  log(action: LogInput): Promise<LoggedAction>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Stores that can announce their own changes. `localStore` can (two hooks on
 * one page, or another tab); Supabase doesn't need to, because the hook is the
 * only writer in that session.
 */
export interface ObservableStore extends TrackerStore {
  subscribe(listener: () => void): () => void;
}

export function isObservable(store: TrackerStore): store is ObservableStore {
  return typeof (store as ObservableStore).subscribe === "function";
}

export type TrackerSource = "local" | "supabase";

export interface StoreHandle {
  store: TrackerStore;
  source: TrackerSource;
}

/**
 * Row ids are Supabase primary keys (`uuid`), so they have to be uuid-shaped
 * even when generated offline — that's what lets us migrate local rows later by
 * id and stay idempotent.
 *
 * `crypto.randomUUID` needs a secure context, which excludes plain-HTTP LAN
 * testing, so there's a v4-shaped fallback. Ids aren't a security boundary
 * here; they only need to not collide.
 */
export function newActionId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // fall through to the manual path
    }
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Fill in the bookkeeping fields and normalise the numbers we promise about. */
export function materialise(input: LogInput): LoggedAction {
  return {
    ...input,
    id: newActionId(),
    loggedAt: input.loggedAt ?? new Date().toISOString(),
    // Declines are worth zero by definition, and nothing is ever negative.
    gramsSaved:
      input.status === "declined" ? 0 : Math.max(0, numberOr(input.gramsSaved, 0)),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Pick a store: Supabase when it's both configured and signed in, otherwise
 * local. The Supabase modules are imported dynamically so that an app with no
 * Supabase env never pulls the client into the bundle it ships.
 */
/**
 * Pick the store to use.
 *
 * Local storage, always. GridMap deliberately has no accounts: your impact
 * history lives in your browser and is never sent anywhere. That keeps the
 * whole app deployable as a static frontend plus one cached API route, with no
 * database, no auth flow and no personal data to look after.
 *
 * The `TrackerStore` interface stays in place so a synced backend could be
 * added later without touching the UI.
 */
export async function createStore(): Promise<StoreHandle> {
  const { localStore } = await import("./localStore");
  return { store: localStore, source: "local" };
}
