/**
 * `localStorage`-backed tracker store.
 *
 * This is the default, and for most users it's the only one they'll ever touch:
 * the app works with zero accounts and zero config. Three things it has to get
 * right — never touch `window` at module scope (Next renders this on the
 * server), never throw on bad data (a half-written key shouldn't erase someone's
 * progress screen), and tell every listener when something changed.
 */

import type { LoggedAction } from "@/lib/types";
import { materialise, type LogInput, type ObservableStore } from "./store";

/** Versioned so a future shape change can migrate instead of guessing. */
export const STORAGE_KEY = "gridmap.actions.v1";

/**
 * Plenty for years of daily logging, and small enough that we're nowhere near
 * the ~5 MB per-origin budget (~200 bytes per row → ~0.3 MB).
 */
export const MAX_ACTIONS = 1500;

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // Access can throw outright in Safari private mode / blocked third-party
    // storage, so this needs the try, not just a truthiness check.
    return window.localStorage;
  } catch {
    return null;
  }
}

const KINDS = new Set(["shift", "habit"]);
const STATUSES = new Set(["done", "declined"]);

/**
 * Anything that isn't recognisably an action is dropped rather than repaired —
 * a partial row would show up as a wrong number, which is worse than a missing
 * one.
 */
function parseAction(value: unknown): LoggedAction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.kind !== "string" || !KINDS.has(raw.kind)) return null;
  if (typeof raw.subjectId !== "string") return null;
  if (typeof raw.loggedAt !== "string" || Number.isNaN(Date.parse(raw.loggedAt))) return null;
  if (typeof raw.status !== "string" || !STATUSES.has(raw.status)) return null;

  const gramsSaved =
    typeof raw.gramsSaved === "number" && Number.isFinite(raw.gramsSaved)
      ? Math.max(0, raw.gramsSaved)
      : 0;

  return {
    id: raw.id,
    kind: raw.kind as LoggedAction["kind"],
    subjectId: raw.subjectId,
    label: typeof raw.label === "string" ? raw.label : raw.subjectId,
    loggedAt: raw.loggedAt,
    gramsSaved: raw.status === "declined" ? 0 : gramsSaved,
    baselineGrams: optionalNumber(raw.baselineGrams),
    actualGrams: optionalNumber(raw.actualGrams),
    status: raw.status as LoggedAction["status"],
    regionBa: typeof raw.regionBa === "string" ? raw.regionBa : undefined,
  };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Newest first — that's the order the UI shows them in. */
function byNewest(a: LoggedAction, b: LoggedAction): number {
  return b.loggedAt.localeCompare(a.loggedAt);
}

/**
 * Read is deliberately non-destructive: corrupt JSON returns an empty list and
 * leaves the bytes alone, so a bug in a future version can still be recovered
 * from the browser console instead of being silently wiped on page load.
 */
export function readActions(): LoggedAction[] {
  const storage = getStorage();
  if (!storage) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // v1 stores a bare array; accept `{ actions: [...] }` too so a wrapped
  // future format can be read by this version without crashing.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { actions?: unknown })?.actions)
      ? ((parsed as { actions: unknown[] }).actions)
      : [];

  const actions: LoggedAction[] = [];
  for (const entry of list) {
    const action = parseAction(entry);
    if (action) actions.push(action);
  }
  return actions.sort(byNewest).slice(0, MAX_ACTIONS);
}

function writeActions(actions: LoggedAction[]): void {
  const storage = getStorage();
  if (!storage) return;
  const capped = [...actions].sort(byNewest).slice(0, MAX_ACTIONS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Out of quota (or storage disabled mid-session). Keep the recent history
    // rather than losing the write entirely.
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(capped.slice(0, 100)));
    } catch {
      // Nothing more we can do; the in-memory list still renders this session.
    }
  }
}

/* ------------------------------------------------------------------ *
 * Change notification
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();
let storageListener: ((event: StorageEvent) => void) | null = null;

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One broken consumer shouldn't stop the others from updating.
    }
  }
}

/**
 * The `storage` event only fires in *other* tabs, which is exactly the gap the
 * in-process listener set doesn't cover. Attached on first subscriber so this
 * module stays inert during SSR and in tests that never subscribe.
 */
function attachStorageListener(): void {
  if (storageListener || typeof window === "undefined") return;
  storageListener = (event: StorageEvent) => {
    // `key === null` means another tab called `localStorage.clear()`.
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    notify();
  };
  window.addEventListener("storage", storageListener);
}

function detachStorageListener(): void {
  if (!storageListener || typeof window === "undefined") return;
  window.removeEventListener("storage", storageListener);
  storageListener = null;
}

export const localStore: ObservableStore = {
  async list(): Promise<LoggedAction[]> {
    return readActions();
  },

  async log(input: LogInput): Promise<LoggedAction> {
    const action = materialise(input);
    writeActions([action, ...readActions()]);
    notify();
    return action;
  },

  async remove(id: string): Promise<void> {
    const remaining = readActions().filter((a) => a.id !== id);
    writeActions(remaining);
    notify();
  },

  async clear(): Promise<void> {
    const storage = getStorage();
    try {
      storage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — the next write will overwrite whatever is there.
    }
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    attachStorageListener();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) detachStorageListener();
    };
  },
};
