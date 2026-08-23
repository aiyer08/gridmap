"use client";

/**
 * The tracker, as the UI sees it.
 *
 * Responsibilities, in the order they matter:
 *
 * 1. Never block or flash. Logging is optimistic — the number moves the instant
 *    the user taps, and only rolls back if the write actually fails.
 * 2. Be hydration-safe. Nothing reads `localStorage` during render; the list
 *    loads in an effect and `ready` says when it's real. Until then the totals
 *    are honest zeros, which match on the server and the client.
 * 3. Pick up the right store. Local by default, Supabase once someone signs in,
 *    and the anonymous history follows them across.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Appliance,
  Habit,
  LoggedAction,
  RunWindow,
  TrackerSummary,
} from "@/lib/types";
import {
  createStore,
  isObservable,
  materialise,
  type LogInput,
  type TrackerSource,
  type TrackerStore,
} from "./store";
import { localStore } from "./localStore";
import { isSupabaseConfigured, onAuthStateChange } from "./supabaseClient";
import {
  DEFAULT_TIMEZONE,
  summarise,
  valueHabit,
  valueShift,
  weeklyBreakdown,
  dailyBreakdown,
  weeklyReport,
  type DayBucket,
  type WeekBucket,
  type WeeklyReport,
} from "./summary";

/**
 * Two taps on the same button, or a component that remounts mid-animation,
 * shouldn't double-count. Anything longer than this and we assume they meant it
 * (two loads of laundry in a row is a real thing).
 */
export const DEDUPE_MS = 15_000;

/**
 * Module-level, not a ref: two components can both render a log button for the
 * same appliance, and the guard has to hold across them.
 */
const recentLogs = new Map<string, number>();

function isDuplicate(key: string, nowMs: number): boolean {
  const last = recentLogs.get(key);
  if (last !== undefined && nowMs - last < DEDUPE_MS) return true;
  recentLogs.set(key, nowMs);
  // Cheap housekeeping so this can't grow all session.
  if (recentLogs.size > 64) {
    for (const [k, t] of recentLogs) {
      if (nowMs - t >= DEDUPE_MS) recentLogs.delete(k);
    }
  }
  return false;
}

/** How often "today" is re-checked, for a tab left open past midnight. */
const CLOCK_TICK_MS = 5 * 60_000;

function byNewest(a: LoggedAction, b: LoggedAction): number {
  return b.loggedAt.localeCompare(a.loggedAt);
}

export interface UseTrackerOptions {
  /**
   * IANA zone the weeks and days are measured in — pass `region.timezone` so a
   * "week" means the same thing as the grid forecast the user is looking at.
   */
  timezone?: string;
}

export interface UseTrackerResult {
  actions: LoggedAction[];
  summary: TrackerSummary;
  weekly: WeekBucket[];
  daily: DayBucket[];
  report: WeeklyReport;
  /** Escape hatch for anything the wrappers below don't cover. */
  log: (input: LogInput) => Promise<LoggedAction | null>;
  logShift: (
    appliance: Appliance,
    window: RunWindow,
    baseline: { avgIntensity: number },
    regionBa?: string,
  ) => Promise<LoggedAction | null>;
  logHabit: (
    habit: Habit,
    gridIntensityGPerKWh: number,
    regionBa?: string,
  ) => Promise<LoggedAction | null>;
  /** "Not this time" — recorded, worth zero, never held against them. */
  decline: (subject: Appliance | Habit, regionBa?: string) => Promise<LoggedAction | null>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  /** False until the stored history has loaded. Gate skeletons on this. */
  ready: boolean;
  source: TrackerSource;
  /** Set when a write failed and was rolled back, so the UI can say so. */
  error: string | null;
}

export function useTracker(options: UseTrackerOptions = {}): UseTrackerResult {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;

  const [actions, setActions] = useState<LoggedAction[]>([]);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<TrackerSource>("local");
  const [error, setError] = useState<string | null>(null);
  // Bumped on sign-in/sign-out to re-pick the store and reload from it.
  const [storeEpoch, setStoreEpoch] = useState(0);

  // Day-granular, so the initial server and client values agree in practice;
  // refreshed on a timer so a long-open tab rolls over at midnight.
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date().toISOString()), CLOCK_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  const storeRef = useRef<TrackerStore>(localStore);

  /* ---------------- load ---------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { store, source: picked } = await createStore();
      if (cancelled) return;
      storeRef.current = store;
      setSource(picked);

      // Signing in shouldn't feel like starting over: bring the anonymous
      // history along. Deduped remotely, so running it every sign-in is safe.
      if (picked === "supabase") {
        try {
          const { migrateLocalToSupabase } = await import("./supabaseStore");
          await migrateLocalToSupabase(localStore, store);
        } catch {
          // The migration is a nice-to-have; a failure must not block the read.
        }
      }
      if (cancelled) return;

      try {
        const loaded = await store.list();
        if (cancelled) return;
        setActions([...loaded].sort(byNewest));
      } catch {
        if (!cancelled) setError("Couldn't load your history. It's still saved.");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storeEpoch]);

  /* ---------------- stay in sync ---------------- */

  // Another hook consumer, or another tab, changed the local store.
  useEffect(() => {
    const store = storeRef.current;
    if (!isObservable(store)) return;
    return store.subscribe(() => {
      void store.list().then((loaded) => setActions([...loaded].sort(byNewest)));
    });
  }, [storeEpoch, ready]);

  // Sign-in/sign-out swaps the backing store underneath us.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    return onAuthStateChange(() => {
      setReady(false);
      setStoreEpoch((n) => n + 1);
    });
  }, []);

  /* ---------------- writes ---------------- */

  const log = useCallback(async (input: LogInput): Promise<LoggedAction | null> => {
    // Give the optimistic row a real id and timestamp so the list can key on it
    // and the eventual server row lands in the same place.
    const optimistic = materialise(input);
    setActions((prev) => [optimistic, ...prev].sort(byNewest));
    setError(null);

    try {
      const saved = await storeRef.current.log({ ...input, loggedAt: optimistic.loggedAt });
      setActions((prev) =>
        prev.map((a) => (a.id === optimistic.id ? saved : a)).sort(byNewest),
      );
      return saved;
    } catch {
      setActions((prev) => prev.filter((a) => a.id !== optimistic.id));
      setError("That didn't save. Give it another go?");
      return null;
    }
  }, []);

  const logShift = useCallback<UseTrackerResult["logShift"]>(
    async (appliance, window, baseline, regionBa) => {
      if (isDuplicate(`shift:${appliance.id}:${window.id || window.startTs}`, Date.now())) {
        return null;
      }
      const valued = valueShift(appliance, window, baseline);
      return log({
        kind: "shift",
        subjectId: appliance.id,
        label: appliance.label,
        gramsSaved: valued.gramsSaved,
        baselineGrams: valued.baselineGrams,
        actualGrams: valued.actualGrams,
        status: "done",
        regionBa,
      });
    },
    [log],
  );

  const logHabit = useCallback<UseTrackerResult["logHabit"]>(
    async (habit, gridIntensityGPerKWh, regionBa) => {
      if (isDuplicate(`habit:${habit.id}`, Date.now())) return null;
      return log({
        kind: "habit",
        subjectId: habit.id,
        label: habit.label,
        gramsSaved: valueHabit(habit, gridIntensityGPerKWh),
        status: "done",
        regionBa,
      });
    },
    [log],
  );

  const decline = useCallback<UseTrackerResult["decline"]>(
    async (subject, regionBa) => {
      // Appliances have run energy; habits have saved energy. That's the only
      // difference we need to tell them apart.
      const kind = "kWhPerRun" in subject ? "shift" : "habit";
      return log({
        kind,
        subjectId: subject.id,
        label: subject.label,
        gramsSaved: 0,
        status: "declined",
        regionBa,
      });
    },
    [log],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    let removed: LoggedAction | undefined;
    setActions((prev) => {
      removed = prev.find((a) => a.id === id);
      return prev.filter((a) => a.id !== id);
    });
    try {
      await storeRef.current.remove(id);
    } catch {
      if (removed) setActions((prev) => [removed!, ...prev].sort(byNewest));
      setError("Couldn't remove that one.");
    }
  }, []);

  const clear = useCallback(async (): Promise<void> => {
    let previous: LoggedAction[] = [];
    setActions((prev) => {
      previous = prev;
      return [];
    });
    try {
      await storeRef.current.clear();
    } catch {
      setActions(previous);
      setError("Couldn't clear your history.");
    }
  }, []);

  /* ---------------- derived ---------------- */

  const summary = useMemo(() => summarise(actions, now, timezone), [actions, now, timezone]);
  const weekly = useMemo(() => weeklyBreakdown(actions, now, timezone), [actions, now, timezone]);
  const daily = useMemo(() => dailyBreakdown(actions, now, timezone), [actions, now, timezone]);
  const report = useMemo(() => weeklyReport(actions, now, timezone), [actions, now, timezone]);

  return {
    actions,
    summary,
    weekly,
    daily,
    report,
    log,
    logShift,
    logHabit,
    decline,
    remove,
    clear,
    ready,
    source,
    error,
  };
}
